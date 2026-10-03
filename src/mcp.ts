import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { id, json, now } from "./db.js";
import { atomicWrite } from "./config.js";
import type { App } from "./app.js";
import type { RunContext } from "./claude/config.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

/** Wall-clock "2026-10-02T21:30" in `tz` → epoch ms. Strings with an explicit offset are taken as-is. */
export function zonedToEpoch(value: string, tz: string): number {
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(value)) return Date.parse(value);
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) throw new Error(`Can't read the time "${value}". Use YYYY-MM-DDTHH:MM in the user's local time.`);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  const offset = (t: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(t))
        .map((p) => [p.type, p.value]),
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - t;
  };
  let epoch = guess - offset(guess);
  epoch = guess - offset(epoch);
  return epoch;
}

const when = {
  at: z.string().optional().describe("One-time: local date-time YYYY-MM-DDTHH:MM in the user's timezone"),
  in_minutes: z.number().positive().optional().describe("One-time: this many minutes from now"),
  cron: z.string().optional().describe("Recurring: 5-field cron in the user's timezone, e.g. '0 7 * * 1-5'"),
};

function resolveWhen(app: App, w: { at?: string; in_minutes?: number; cron?: string }) {
  if (w.cron) return { cron: w.cron, at: null };
  if (w.in_minutes) return { cron: null, at: now() + w.in_minutes * 60_000 };
  if (w.at) return { cron: null, at: zonedToEpoch(w.at, app.settings().timezone) };
  throw new Error("Give at, in_minutes or cron");
}

export function libraryIndex(app: App): Record<string, { title: string; createdAt: number }> {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.paths.home, "library", ".index.json"), "utf8"));
  } catch {
    return {};
  }
}

function buildServer(app: App, ctx: RunContext) {
  const server = new McpServer({ name: "kin", version: "0.1.0" });
  const main = () => app.messages.mainThread();

  server.registerTool(
    "send_message",
    {
      description:
        "Post a message to the user's chat. In the live conversation, just reply normally instead. From background work, use only when it's worth interrupting the user.",
      inputSchema: { text: z.string().min(1) },
    },
    async ({ text: body }) => {
      const threadId = ctx.runId ? main() : ctx.threadId;
      app.messages.create({ threadId, role: "agent", text: body.trim(), source: ctx.runId ? "background" : "chat" });
      if (ctx.runId) {
        app.store.run("UPDATE runs SET surfaced=1 WHERE id=?", ctx.runId);
        app.session(threadId).note(`You (from background job ${ctx.kind}) messaged the user: "${body.slice(0, 1500)}"`);
      }
      return text("Sent.");
    },
  );

  server.registerTool(
    "react",
    {
      description: "Tapback-react to one of the user's messages (id from <msg id=...>). Same emoji again removes it.",
      inputSchema: { message_id: z.string(), emoji: z.string().min(1).max(16) },
    },
    async ({ message_id, emoji }) => {
      const msg = app.messages.get(message_id);
      if (!msg) return fail("No message with that id.");
      if (msg.role !== "user") return fail("You can only react to the user's messages.");
      app.messages.react(message_id, "agent", emoji);
      return text("Reacted.");
    },
  );

  server.registerTool(
    "set_status",
    { description: "Set the one-line status shown under your name while you work (e.g. 'comparing flights…').", inputSchema: { text: z.string().max(80) } },
    async ({ text: status }) => {
      if (ctx.runId) app.store.run("INSERT INTO run_log(run_id,at,type,text) VALUES(?,?,?,?)", ctx.runId, now(), "status", status);
      else app.session(ctx.threadId).setState("working", status);
      return text("ok");
    },
  );

  server.registerTool(
    "schedule_reminder",
    {
      description: "Deliver a reminder message to the user at a time (no thinking needed when it fires). Give at, in_minutes, or cron.",
      inputSchema: { text: z.string().min(1).describe("The reminder as the user should see it"), ...when },
    },
    async (args) => {
      try {
        const w = resolveWhen(app, args);
        const s = app.scheduler.create({ title: args.text.slice(0, 80), kind: "reminder", prompt: args.text, ...w });
        return text(`Scheduled reminder ${s.id}: ${s.human}`);
      } catch (e) {
        return fail(String(e instanceof Error ? e.message : e));
      }
    },
  );

  server.registerTool(
    "schedule_task",
    {
      description:
        "Schedule background work that needs thinking (briefings, watches, recurring checks). Runs on a separate model with the same tools; it only messages the user if worthwhile. Write a complete prompt.",
      inputSchema: { title: z.string().min(1).max(80), prompt: z.string().min(1), ...when },
    },
    async (args) => {
      try {
        const w = resolveWhen(app, args);
        const s = app.scheduler.create({ title: args.title, kind: "task", prompt: args.prompt, ...w });
        return text(`Scheduled ${s.id}: ${s.human}`);
      } catch (e) {
        return fail(String(e instanceof Error ? e.message : e));
      }
    },
  );

  server.registerTool("list_schedules", { description: "List reminders and scheduled tasks.", inputSchema: {} }, async () =>
    text(
      json(
        app.scheduler.list(false).map((s) => ({ id: s.id, title: s.title, kind: s.kind, when: s.human, next: s.nextAt && new Date(s.nextAt).toISOString() })),
      ),
    ),
  );

  server.registerTool("cancel_schedule", { description: "Cancel a reminder or scheduled task by id.", inputSchema: { id: z.string() } }, async (a) =>
    app.scheduler.remove(a.id) ? text("Cancelled.") : fail("No schedule with that id."),
  );

  server.registerTool(
    "start_task",
    {
      description:
        "Hand a longer job to a background worker (research, comparisons, building something) so the chat stays responsive. The worker can't see this chat: give complete instructions. The user sees a live task card; you get the result as a [background] note.",
      inputSchema: { title: z.string().min(1).max(80).describe("Short card title"), instructions: z.string().min(1) },
    },
    async (a) => {
      if (ctx.runId) return fail("Background runs can't start more tasks.");
      const run = app.runner.start({ kind: "task", title: a.title, prompt: a.instructions, threadId: ctx.threadId, card: true, reportBack: true });
      return text(`Started task ${run.id}.`);
    },
  );

  const goalShape = {
    category: z.enum(["health", "finance", "career", "relationships", "productivity", "learning", "home", "other"]).optional(),
    why: z.string().optional(),
    plan: z.array(z.object({ step: z.string(), done: z.boolean().default(false) })).optional(),
    progress: z.number().min(0).max(1).optional(),
    checkin_cron: z.string().nullable().optional().describe("Cron for check-ins in the user's timezone, or null to stop"),
    notes: z.string().optional(),
    status: z.enum(["active", "paused", "done"]).optional(),
  };

  server.registerTool(
    "goal_create",
    { description: "Create a long-running goal with a plan and optional check-in schedule.", inputSchema: { title: z.string().min(1), ...goalShape } },
    async (a) => {
      const goalId = id("g_");
      app.store.run(
        "INSERT INTO goals(id,title,category,why,plan,progress,checkin,notes,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        goalId,
        a.title,
        a.category ?? "other",
        a.why ?? "",
        json(a.plan ?? []),
        a.progress ?? 0,
        a.checkin_cron ?? null,
        a.notes ?? "",
        a.status ?? "active",
        now(),
      );
      try {
        if (a.checkin_cron) app.scheduler.syncGoal(goalId, a.title, a.checkin_cron);
      } catch (e) {
        return fail(`Goal ${goalId} created, but the check-in schedule failed: ${e}`);
      }
      app.bus.publish("goals.updated", {});
      return text(`Created goal ${goalId}.`);
    },
  );

  server.registerTool(
    "goal_update",
    {
      description: "Update a goal. append_note adds a dated line to its notes.",
      inputSchema: { id: z.string(), title: z.string().optional(), append_note: z.string().optional(), ...goalShape },
    },
    async (a) => {
      const g = app.goals.get(a.id);
      if (!g) return fail("No goal with that id.");
      const notes = a.append_note ? `${g.notes}${g.notes ? "\n" : ""}${new Date().toISOString().slice(0, 10)}: ${a.append_note}` : (a.notes ?? g.notes);
      app.goals.patch(a.id, {
        title: a.title,
        category: a.category,
        why: a.why,
        plan: a.plan,
        progress: a.progress,
        checkin: a.checkin_cron === undefined ? undefined : a.checkin_cron,
        notes,
        status: a.status,
      });
      return text("Updated.");
    },
  );

  server.registerTool("goal_list", { description: "List the user's goals.", inputSchema: {} }, async () => text(json(app.goals.list())));

  server.registerTool(
    "idea_add",
    {
      description: "Suggest something you could do for the user (shows in the Today tab with a 'Do it' button that sends `prompt` to you).",
      inputSchema: { title: z.string().max(90), why: z.string().max(240), prompt: z.string() },
    },
    async (a) => {
      const dup = app.store.get("SELECT id FROM ideas WHERE dismissed=0 AND lower(title)=lower(?)", a.title);
      if (dup) return text("Already suggested.");
      app.store.run("INSERT INTO ideas(id,title,why,prompt,created_at) VALUES(?,?,?,?,?)", id("i_"), a.title, a.why, a.prompt, now());
      app.bus.publish("today.updated", {});
      return text("Added.");
    },
  );

  server.registerTool(
    "feed_card",
    {
      description: "Add a card to the Today feed (news, calendar, email, weather, note, goal).",
      inputSchema: {
        kind: z.enum(["news", "calendar", "email", "weather", "note", "goal"]),
        title: z.string().max(120),
        body: z.string().describe("Markdown, short"),
        actions: z.array(z.object({ label: z.string().max(24), prompt: z.string() })).max(3).optional(),
      },
    },
    async (a) => {
      app.store.run("INSERT INTO cards(id,kind,title,body,actions,created_at) VALUES(?,?,?,?,?,?)", id("c_"), a.kind, a.title, a.body, json(a.actions ?? []), now());
      app.bus.publish("today.updated", {});
      return text("Added.");
    },
  );

  server.registerTool(
    "set_brief",
    {
      description: "Publish today's morning brief (replaces any earlier brief today).",
      inputSchema: { title: z.string().max(120), body: z.string(), actions: z.array(z.object({ label: z.string().max(24), prompt: z.string() })).max(3).optional() },
    },
    async (a) => {
      app.store.run("UPDATE cards SET dismissed=1 WHERE kind='brief' AND dismissed=0");
      app.store.run("INSERT INTO cards(id,kind,title,body,actions,created_at) VALUES(?,?,?,?,?,?)", id("c_"), "brief", a.title, a.body, json(a.actions ?? []), now());
      app.bus.publish("today.updated", {});
      app.push.send({ title: a.title, body: "Your morning brief is ready", kind: "messages", url: "/today" });
      return text("Brief published.");
    },
  );

  server.registerTool(
    "library_save",
    {
      description: "Register a file you made so it appears in the user's Library. Files outside library/ are copied in.",
      inputSchema: { path: z.string().describe("Path relative to your home, or absolute"), title: z.string().max(120) },
    },
    async (a) => {
      const home = app.paths.home;
      const lib = path.join(home, "library");
      const src = path.resolve(home, a.path);
      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return fail("File not found.");
      let dest = src;
      if (!src.startsWith(lib + path.sep)) {
        dest = path.join(lib, path.basename(src));
        fs.copyFileSync(src, dest);
      }
      const rel = path.relative(lib, dest).split(path.sep).join("/");
      const index = libraryIndex(app);
      index[rel] = { title: a.title, createdAt: index[rel]?.createdAt ?? now() };
      atomicWrite(path.join(lib, ".index.json"), JSON.stringify(index, null, 2), 0o644);
      app.bus.publish("library.updated", {});
      return text(`Saved as library/${rel}.`);
    },
  );

  server.registerTool(
    "notify",
    { description: "Send a push notification (respects quiet hours). Messages already notify; rarely needed.", inputSchema: { title: z.string().max(80), body: z.string().max(240) } },
    async (a) => {
      app.push.send({ title: a.title, body: a.body, kind: "messages" });
      if (ctx.runId) app.store.run("UPDATE runs SET surfaced=1 WHERE id=?", ctx.runId);
      return text("Sent.");
    },
  );

  server.registerTool(
    "approve",
    {
      description: "Internal permission gate used by the system. Never call this yourself.",
      inputSchema: { tool_name: z.string(), input: z.any(), tool_use_id: z.string().optional() },
    },
    async (a) => {
      const result = await app.approvals.request(ctx, a.tool_name, a.input ?? {});
      return text(JSON.stringify(result));
    },
  );

  return server;
}

/** Stateless streamable-HTTP MCP endpoint. The bearer token identifies which run is calling. */
export async function handleMcp(app: App, req: Request): Promise<Response> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const ctx = app.tokens.get(token);
  if (!ctx) return new Response(JSON.stringify({ error: "unknown run token" }), { status: 401 });
  const server = buildServer(app, ctx);
  // SSE responses send headers immediately and a keep-alive comment every 15s, so an approval card can
  // wait hours for the owner without the CLI's HTTP client timing out.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: false });
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  return res;
}

