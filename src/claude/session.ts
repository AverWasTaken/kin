import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { env } from "../config.js";
import { id, now } from "../db.js";
import { chatPrompt, localTime } from "../home.js";
import type { App } from "../app.js";
import type { AgentState, Message } from "../shared/api.js";
import { launch, models } from "./config.js";
import { parseLine, planLimit, resetTime, toolStatus, type ClaudeEvent } from "./parse.js";
import { executable, lineReader } from "./process.js";

type Pending = { kind: "user"; ids: string[]; line: string } | { kind: "note"; line: string };

/**
 * One long-lived `claude -p` process per thread, fed through stream-json stdin.
 * Receipts: a user message is "delivered" once written to stdin and "read" when Claude echoes it back
 * (--replay-user-messages), which happens when the message actually enters the model's context.
 */
export class MainSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private token: string | null = null;
  private pending: Pending[] = []; // written, awaiting echo
  private notes: string[] = []; // delivered with the next user message
  private inTurn = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private stale = false;
  private turnTokens = 0;
  private turnStarted = 0;
  private output: Promise<void> = Promise.resolve();
  private restarts = 0;
  private interrupting = false;
  private turnIds: string[] = []; // user messages consumed in the current turn
  private lastActivity = now();
  private watchdog: NodeJS.Timeout | null = null;
  state: AgentState = "idle";
  status = "";

  constructor(
    readonly app: App,
    readonly threadId: string,
  ) {}

  get busy() {
    return this.inTurn || this.pending.length > 0;
  }

  get alive() {
    return !!this.child;
  }

  /** Delivers a user message (and any queued background notes) to the model. */
  send(message: Message) {
    const header = `<msg id="${message.id}" time="${localTime(this.app.settings().timezone, new Date(message.createdAt))}">`;
    const parts: string[] = [];
    if (this.notes.length) parts.push(...this.notes.splice(0));
    let body = message.text;
    if (message.replyTo) {
      const quoted = this.app.messages.get(message.replyTo);
      if (quoted) body = `[replying to ${quoted.role === "user" ? "their own" : "your"} message ${quoted.id}: "${quoted.text.slice(0, 200)}"]\n${body}`;
    }
    for (const a of message.attachments ?? []) {
      const upload = this.app.store.get<{ path: string }>("SELECT path FROM uploads WHERE id=?", a.id);
      if (upload) body += `\n[attached ${a.mime.startsWith("image/") ? "image" : "file"}: ${upload.path}]`;
    }
    parts.push(`${header}\n${body}\n</msg>`);
    this.write({ kind: "user", ids: [message.id], line: parts.join("\n\n") });
  }

  /** A system note. `wake` starts a turn now (e.g. a background task finished); otherwise it rides along with the next message. */
  note(text: string, wake = false) {
    const line = `[background] ${text}`;
    if (wake) this.write({ kind: "note", line: [...this.notes.splice(0), line].join("\n\n") });
    else this.notes.push(line);
  }

  reactionNote(text: string) {
    this.notes.push(`[reaction] ${text}`);
  }

  private write(p: Pending) {
    if (this.app.stopping) return;
    if (this.app.pausedUntil() > now()) {
      if (p.kind === "user") this.app.messages.setStatus(this.threadId, p.ids, "sent");
      this.app.notice(this.threadId, `I'm out of usage until ${this.app.formatTime(this.app.pausedUntil())}. I'll pick this up then.`);
      this.app.deferred.push(() => this.write(p));
      return;
    }
    this.ensure();
    this.clearIdle();
    this.pending.push(p);
    this.child!.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: p.line } }) + "\n");
    if (p.kind === "user") this.app.messages.setStatus(this.threadId, p.ids, "delivered");
  }

  private ensure() {
    if (this.child) return;
    if (this.app.stopping) throw new Error("Kin is shutting down");
    const thread = this.app.store.get<{ session_id: string | null }>("SELECT session_id FROM threads WHERE id=?", this.threadId);
    // Only resume a session Claude actually saved: a process killed during its first turn leaves an id with no transcript.
    const resume = thread?.session_id && sessionSaved(thread.session_id) ? thread.session_id : undefined;
    const sessionId = resume ? undefined : crypto.randomUUID();
    if (sessionId) this.app.store.run("UPDATE threads SET session_id=? WHERE id=?", sessionId, this.threadId);
    const { model, effort } = models.chat();
    const run = launch(this.app, {
      ctx: { threadId: this.threadId, runId: null, kind: "chat", readOnly: false },
      model,
      effort,
      systemPrompt: chatPrompt(this.app.agent(), this.app.settings(), this.app.paths.home),
      stream: true,
      resume,
      sessionId,
    });
    this.token = run.token;
    this.stale = false;
    const spec = executable(env.claude);
    const child = spawn(spec.command, [...spec.prefix, ...run.args], {
      cwd: this.app.paths.home,
      env: run.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.app.log("session", `spawned ${model}/${effort} for ${this.threadId}${resume ? ` (resume ${resume})` : ""}`);
    let stderr = "";
    const feed = lineReader(
      (line) => {
        let data: unknown;
        try {
          data = JSON.parse(line);
        } catch {
          return;
        }
        for (const ev of parseLine(data)) this.handle(ev);
      },
      () => this.app.log("session", "oversized stream line dropped"),
    );
    child.stdout.on("data", (d) => {
      this.lastActivity = now();
      feed(d);
    });
    this.lastActivity = now();
    if (!this.watchdog) {
      // If the CLI silently drops queued input (e.g. after an interrupt), don't stay "busy" forever.
      this.watchdog = setInterval(() => {
        if (!this.busy || this.inTurn || now() - this.lastActivity < 10 * 60_000 || this.app.approvals.waitingChat(this.threadId)) return;
        this.app.log("session", `dropping ${this.pending.length} unechoed input(s) for ${this.threadId}`);
        this.pending.splice(0);
        this.setState("idle", "");
        this.armIdle();
      }, 60_000);
      this.watchdog.unref();
    }
    child.stderr.on("data", (d) => (stderr = (stderr + d.toString()).slice(-8000)));
    child.stdin.on("error", () => {});
    child.on("error", (e) => this.app.log("session", `spawn error: ${e}`));
    child.on("close", (code) => {
      feed.flush();
      if (this.child !== child) return;
      this.child = null;
      if (this.token) this.app.tokens.delete(this.token);
      this.inTurn = false;
      this.app.approvals.cancelForThread(this.threadId, null);
      const unanswered = this.pending.splice(0);
      if (this.app.stopping) return;
      if (code && code !== 0) this.app.log("session", `exited ${code}: ${stderr.slice(-1000)}`);
      if (planLimit(stderr)) return this.limitHit(stderr, unanswered);
      if (unanswered.length && !this.interrupting && this.restarts < 2) {
        // Crash with messages still in flight: resume the session (or start fresh if it's gone) and resend once.
        this.restarts++;
        if (/No conversation found/i.test(stderr)) this.app.store.run("UPDATE threads SET session_id=NULL WHERE id=?", this.threadId);
        for (const p of unanswered) this.write(p);
        return;
      }
      if (unanswered.length && code) this.app.notice(this.threadId, "I crashed while working on that. Mind sending it again?");
      this.setState("idle", "");
    });
  }

  private handle(ev: ClaudeEvent) {
    switch (ev.type) {
      case "init":
        this.app.setConnections(ev.mcp);
        if (ev.sessionId) this.app.store.run("UPDATE threads SET session_id=? WHERE id=?", ev.sessionId, this.threadId);
        break;
      case "session":
        break;
      case "user_echo": {
        // Match the echo to what we wrote (by message id, or exact text for notes); ignore anything else
        // the CLI injects into the transcript so receipts can't drift.
        const i = this.pending.findIndex((p) =>
          p.kind === "user" ? ev.text.includes(`<msg id="${p.ids[0]}"`) : ev.text.trim() === p.line.trim(),
        );
        if (i < 0) break;
        const [p] = this.pending.splice(i, 1);
        if (!this.inTurn) {
          this.inTurn = true;
          this.turnStarted = now();
          this.turnTokens = 0;
          this.turnIds = [];
        }
        if (p.kind === "user") {
          this.turnIds.push(...p.ids);
          this.app.messages.setStatus(this.threadId, p.ids, "read");
          this.setState("reading", "");
        }
        break;
      }
      case "block_start":
        if (ev.kind === "thinking") this.setState("thinking", "thinking…");
        else if (ev.kind === "text") this.setState("typing", "");
        // Reacting or setting a status is not "work": don't flash the laptop animation for it.
        else if (!/^mcp__kin__(react|set_status)$/.test(ev.name ?? "")) this.setState("working", ev.name ? toolStatus(ev.name) : "working on it…");
        break;
      case "tool": {
        this.app.observeTool(ev.name);
        const s = toolStatus(ev.name, ev.input);
        if (s) this.setState("working", s);
        break;
      }
      case "text":
        this.emitMessage(ev.text);
        break;
      case "rate_limit":
        this.app.setRateLimit(ev);
        break;
      case "result":
        this.turnTokens += ev.tokens;
        this.finishTurn(ev);
        break;
      case "control_response":
        break;
    }
  }

  /** One assistant text block is one bubble. */
  private emitMessage(text: string) {
    const body = text.trim();
    if (!body) return;
    this.output = this.output.then(() => {
      try {
        this.app.messages.create({ threadId: this.threadId, role: "agent", text: body, source: "chat" });
      } catch (e) {
        this.app.log("session", `dropped message: ${e}`);
      }
    });
  }

  private finishTurn(ev: Extract<ClaudeEvent, { type: "result" }>) {
    // More echoes pending means queued user messages will start another turn in this process.
    const more = this.pending.length > 0;
    this.inTurn = more;
    this.interrupting = false;
    this.restarts = 0;
    this.app.recordChatTurn(this.threadId, this.turnStarted || now(), this.turnTokens, ev.ok);
    const ids = this.turnIds.splice(0);
    this.turnTokens = 0;
    this.turnStarted = now();
    if (!ev.ok && !/interrupt/i.test(ev.text)) {
      if (planLimit(ev.text)) {
        // The request was consumed but never answered: retry it once the plan resets.
        const retry: Pending[] = ids.length
          ? [{ kind: "note", line: `[background] The usage limit has reset. Finish what the user asked in message(s) ${ids.join(", ")} (above).` }]
          : [];
        this.limitHit(ev.text, retry);
      } else if (/No conversation found/i.test(ev.text)) {
        // Recovered in the close handler (fresh session + resend); not worth surfacing.
        this.app.store.run("UPDATE threads SET session_id=NULL WHERE id=?", this.threadId);
      } else if (ev.text.trim()) this.app.notice(this.threadId, `Something went wrong: ${ev.text.trim().slice(0, 300)}`);
    }
    if (more) return;
    this.output = this.output.then(() => {
      if (this.busy) return;
      this.setState("done", "");
      setTimeout(() => !this.busy && this.state === "done" && this.setState("idle", ""), 1400);
    });
    if (this.stale) this.stop();
    else this.armIdle();
  }

  private limitHit(text: string, unanswered: Pending[]) {
    if (this.app.pausedUntil() <= now()) {
      const until = resetTime(text);
      this.app.pause(until);
      this.app.notice(this.threadId, `I've hit the usage limit on the plan. I'll be back around ${this.app.formatTime(until)}.`);
    }
    for (const p of unanswered) this.app.deferred.push(() => this.write(p));
    this.setState("asleep", "");
  }

  interrupt() {
    if (!this.child || !this.busy) return false;
    this.interrupting = true;
    this.child.stdin.write(
      JSON.stringify({ type: "control_request", request_id: id("int_"), request: { subtype: "interrupt" } }) + "\n",
    );
    this.app.approvals.cancelForThread(this.threadId, null);
    this.setState("idle", "");
    return true;
  }

  /** Called when memory/identity/settings change: restart so the next turn gets the new system prompt. */
  refresh() {
    if (!this.child) return;
    if (this.busy) this.stale = true;
    else this.stop();
  }

  /** Hard stop (thread deleted): no further output from this session. */
  kill() {
    const child = this.child;
    this.child = null;
    this.pending.splice(0);
    this.notes.splice(0);
    this.app.approvals.cancelForThread(this.threadId, null);
    if (this.token) this.app.tokens.delete(this.token);
    this.clearIdle();
    if (this.watchdog) clearInterval(this.watchdog);
    child?.kill("SIGKILL");
  }

  stop() {
    this.clearIdle();
    const child = this.child;
    if (!child) return;
    child.stdin.end();
    const t = setTimeout(() => child.kill("SIGTERM"), 5000);
    child.once("close", () => clearTimeout(t));
  }

  listening(on: boolean) {
    if (this.busy) return;
    if (on && (this.state === "idle" || this.state === "done")) this.setState("listening", "");
    if (!on && this.state === "listening") this.setState("idle", "");
  }

  private armIdle() {
    this.clearIdle();
    this.idleTimer = setTimeout(() => !this.busy && this.stop(), env.idleExitMs);
  }

  private clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  setState(state: AgentState, status: string) {
    if (state === this.state && status === this.status) return;
    this.state = state;
    this.status = status;
    this.app.bus.publish("agent.state", { threadId: this.threadId, state, status });
  }
}

function sessionSaved(sessionId: string) {
  const root = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), "projects");
  try {
    return fs.readdirSync(root).some((dir) => fs.existsSync(path.join(root, dir, `${sessionId}.jsonl`)));
  } catch {
    return true; // can't tell; let --resume decide
  }
}
