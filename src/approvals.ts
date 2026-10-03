import { id, json, now } from "./db.js";
import type { App } from "./app.js";
import type { RunContext } from "./claude/config.js";
import type { ApprovalMeta } from "./shared/api.js";

export type Decision = "once" | "always" | "deny";
type PermissionResult = { behavior: "allow"; updatedInput: unknown } | { behavior: "deny"; message: string };

const READ_VERBS =
  /(^|_)(search|list|get|read|fetch|find|query|download|count|lookup|describe|view|check|status|state|history|summar|profile|whoami)/i;
const EXPIRY_MS = 24 * 3600_000;

/** Parses mcp__<server>__<tool>. */
export function splitTool(name: string) {
  const m = name.match(/^mcp__(.+?)__(.+)$/);
  return m ? { server: m[1], tool: m[2] } : { server: "", tool: name };
}

export function isReadTool(name: string) {
  const { server, tool } = splitTool(name);
  if (!server) return false;
  if (/^(complete_)?authenticate$/.test(tool)) return true; // connector OAuth handshake, driven from chat
  return READ_VERBS.test(tool) && !/(send|create|delete|remove|update|modify|move|trash|reply|forward|draft|call|turn|set|write)/i.test(tool);
}

function words(s: string) {
  return s.replace(/^claude_ai_/, "").replace(/[_-]+/g, " ").trim();
}

export function describe(name: string, input: any): { title: string; detail: string } {
  const { server, tool } = splitTool(name);
  const s = server.toLowerCase();
  const t = tool.toLowerCase();
  let title: string;
  if (s.includes("gmail"))
    title = /send|reply|forward/.test(t)
      ? "Send an email"
      : /draft/.test(t)
        ? "Save an email draft"
        : /trash|delete/.test(t)
          ? "Delete email"
          : /label|modify/.test(t)
            ? "Change email labels"
            : `Gmail: ${words(tool)}`;
  else if (s.includes("calendar"))
    title = /create/.test(t)
      ? "Add a calendar event"
      : /delete/.test(t)
        ? "Delete a calendar event"
        : /update/.test(t)
          ? "Change a calendar event"
          : /respond/.test(t)
            ? "Respond to an invite"
            : `Calendar: ${words(tool)}`;
  else if (s.includes("drive")) title = `Drive: ${words(tool)}`;
  else if (s === "homeassistant") {
    const intent = tool.split("__").pop()!.replace(/^Hass/, "");
    const named: Record<string, string> = {
      TurnOn: "Turn something on",
      TurnOff: "Turn something off",
      LightSet: "Adjust a light",
      Broadcast: "Broadcast on your speakers",
      CancelAllTimers: "Cancel all timers",
      ListAddItem: "Add to a list",
      ListCompleteItem: "Check off a list item",
      ListRemoveItem: "Remove a list item",
      SetVolume: "Change the volume",
      SetVolumeRelative: "Change the volume",
      MediaSearchAndPlay: "Play something",
    };
    title = named[intent] ?? (intent.startsWith("Media") ? "Control media playback" : `Home: ${intent.replace(/([a-z])([A-Z])/g, "$1 $2")}`);
    const target = input && typeof input === "object" ? [(input as any).name, (input as any).area].filter(Boolean).join(" in ") : "";
    if (target) title += `: ${target}`;
  }
  else if (server) title = `${words(server)}: ${words(tool)}`;
  else title = `Use ${tool}`;

  const keys = ["to", "cc", "bcc", "subject", "summary", "title", "start", "end", "attendees", "name", "entity_id", "area", "domain", "body", "message", "description"];
  const lines: string[] = [];
  if (input && typeof input === "object")
    for (const k of keys) {
      const v = (input as any)[k];
      if (v == null || v === "") continue;
      const text = typeof v === "string" ? v : JSON.stringify(v);
      lines.push(`${k}: ${text.length > 600 ? `${text.slice(0, 600)}…` : text}`);
    }
  const detail = lines.length ? lines.join("\n") : JSON.stringify(input ?? {}, null, 2).slice(0, 1500);
  return { title, detail };
}

export class Approvals {
  private waiters = new Map<string, { resolve: (r: PermissionResult) => void; input: unknown; runId: string | null; threadId: string; timer: NodeJS.Timeout }>();

  constructor(readonly app: App) {}

  waitingChat(threadId: string) {
    for (const w of this.waiters.values()) if (w.threadId === threadId && w.runId === null) return true;
    return false;
  }

  waiting(runId: string) {
    for (const w of this.waiters.values()) if (w.runId === runId) return true;
    return false;
  }

  async request(ctx: RunContext, toolName: string, input: unknown): Promise<PermissionResult> {
    if (toolName === "mcp__kin__approve") return { behavior: "deny", message: "Internal tool." };
    if (isReadTool(toolName)) return { behavior: "allow", updatedInput: input };
    if (ctx.readOnly)
      return {
        behavior: "deny",
        message: "This is a read-only background run. Don't take actions here; suggest it to the user with idea_add or send_message instead.",
      };
    if (this.app.allowRules().includes(toolName)) return { behavior: "allow", updatedInput: input };
    if (!this.app.settings().askBeforeActing) return { behavior: "allow", updatedInput: input };

    const approvalId = id("a_");
    const { title, detail } = describe(toolName, input);
    const meta: ApprovalMeta = { approvalId, tool: toolName, title, detail, input, status: "pending" };
    const msg = this.app.messages.create({
      threadId: ctx.threadId,
      role: "agent",
      kind: "approval",
      text: title,
      approval: meta,
      source: ctx.runId ? "background" : "chat",
    });
    this.app.store.run(
      "INSERT INTO approvals(id,run_id,thread_id,message_id,tool,input,status,created_at) VALUES(?,?,?,?,?,?,?,?)",
      approvalId,
      ctx.runId,
      ctx.threadId,
      msg.id,
      toolName,
      json(input),
      "pending",
      now(),
    );
    if (ctx.runId) {
      this.app.store.run("UPDATE runs SET status='waiting' WHERE id=?", ctx.runId);
      const run = this.app.runner.get(ctx.runId);
      if (run) this.app.bus.publish("run.updated", run);
    } else this.app.session(ctx.threadId).setState("working", "waiting for your ok…");
    this.app.push.send({ title: `${this.app.agent().name} needs your ok`, body: `${title}\n${detail.split("\n")[0] ?? ""}`, kind: "approvals" });

    return new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(() => this.resolve(approvalId, "deny", "expired"), EXPIRY_MS);
      this.waiters.set(approvalId, { resolve, input, runId: ctx.runId, threadId: ctx.threadId, timer });
    });
  }

  resolve(approvalId: string, decision: Decision, reason: "user" | "expired" | "cancelled" = "user") {
    const row = this.app.store.get<any>("SELECT * FROM approvals WHERE id=?", approvalId);
    if (!row || row.status !== "pending") return false;
    const status: ApprovalMeta["status"] =
      reason === "expired" ? "expired" : decision === "deny" ? "denied" : decision === "always" ? "always" : "allowed";
    this.app.store.run("UPDATE approvals SET status=?, resolved_at=? WHERE id=?", status, now(), approvalId);
    const msg = this.app.messages.get(row.message_id);
    if (msg?.approval) this.app.messages.update(row.message_id, { approval: { ...msg.approval, status } });
    this.app.bus.publish("approval.resolved", { approvalId, status });
    if (decision === "always") this.app.addAllowRule(row.tool);
    if (row.run_id) {
      this.app.store.run("UPDATE runs SET status='running' WHERE id=? AND status='waiting'", row.run_id);
      const run = this.app.runner.get(row.run_id);
      if (run) this.app.bus.publish("run.updated", run);
    }
    const w = this.waiters.get(approvalId);
    if (w) {
      clearTimeout(w.timer);
      this.waiters.delete(approvalId);
      w.resolve(
        decision === "deny"
          ? {
              behavior: "deny",
              message:
                reason === "expired"
                  ? "The approval request expired without an answer. Don't retry; mention it to the user if relevant."
                  : reason === "cancelled"
                    ? "Cancelled because the user stopped this run."
                    : "The user denied this action. Don't retry it; ask what they'd prefer if it matters.",
            }
          : { behavior: "allow", updatedInput: w.input },
      );
    }
    return true;
  }

  /** On interrupt: deny anything the chat session (runId null) or a given run is waiting on. */
  cancelForThread(threadId: string, runId: string | null) {
    for (const [approvalId, w] of this.waiters)
      if (w.threadId === threadId && w.runId === runId) this.resolve(approvalId, "deny", "cancelled");
  }

  /** Approvals left pending by a previous server process can never be answered: mark them expired. */
  expireOrphans() {
    for (const row of this.app.store.all<any>("SELECT * FROM approvals WHERE status='pending'")) {
      if (this.waiters.has(row.id)) continue;
      this.app.store.run("UPDATE approvals SET status='expired', resolved_at=? WHERE id=?", now(), row.id);
      const msg = this.app.messages.get(row.message_id);
      if (msg?.approval) this.app.messages.update(row.message_id, { approval: { ...msg.approval, status: "expired" } });
    }
  }

  pending() {
    return this.app.store
      .all<{ message_id: string }>("SELECT message_id FROM approvals WHERE status='pending' ORDER BY created_at")
      .map((r) => this.app.messages.get(r.message_id)!)
      .filter(Boolean);
  }
}
