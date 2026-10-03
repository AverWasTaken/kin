import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kin-test-"));
const argsLog = path.join(tmp, "args.log");
process.env.KIN_DATA = path.join(tmp, "data");
process.env.KIN_HOME = path.join(tmp, "home");
process.env.KIN_PORT = String(39000 + Math.floor(Math.random() * 1000));
process.env.KIN_CLAUDE = path.resolve("tests/fake-claude.mjs");
process.env.FAKE_ARGS_LOG = argsLog;
process.env.KIN_WEB_DIST = path.join(tmp, "nowebdist");

const { createApp } = await import("../src/app.js");
const { startServer } = await import("../src/server.js");
const { resolvePaths } = await import("../src/config.js");
const { parseLine, planLimit, resetTime } = await import("../src/claude/parse.js");
const { humanCron } = await import("../src/scheduler.js");
const { zonedToEpoch } = await import("../src/mcp.js");
const { isReadTool, describe: describeTool } = await import("../src/approvals.js");

type App = InstanceType<typeof import("../src/app.js").App>;
let app: App;
let server: import("node:http").Server;
let base: string;
let auth: Record<string, string>;

const until = async <T>(fn: () => T | undefined | null | false, ms = 8000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
};

const api = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(base + url, { method, headers: { ...auth, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  app = createApp(resolvePaths());
  app.start();
  server = startServer(app);
  base = `http://127.0.0.1:${process.env.KIN_PORT}`;
  auth = { authorization: `Bearer ${app.secrets.ownerToken}` };
  await until(() => server.listening);
  const r = await api("POST", "/api/onboarding", {
    agentName: "Pip",
    avatar: { shape: "bean", color: "#6C9BF2", accessory: "beret", eyes: "dot" },
    timezone: "America/Los_Angeles",
    about: { name: "Sam", location: "Portland" },
  });
  expect(r.status).toBe(200);
});

afterAll(() => {
  app.stop();
  server.close();
});

describe("parsing", () => {
  it("normalizes stream-json lines", () => {
    expect(parseLine({ type: "user", message: { content: "hi" }, session_id: "s" })).toEqual([
      { type: "user_echo", text: "hi" },
      { type: "session", sessionId: "s" },
    ]);
    expect(parseLine({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Bash" } } })[0]).toEqual({
      type: "block_start",
      kind: "tool_use",
      name: "Bash",
    });
    const rl = parseLine({ type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.69, resetsAt: 100 } } } });
    expect(rl[0]).toMatchObject({ type: "rate_limit", window: "five_hour", utilization: 0.69, resetsAt: 100000 });
  });
  it("detects plan limits", () => {
    expect(planLimit("Claude usage limit reached. Your limit resets in 2 minutes")).toBe(true);
    expect(planLimit("ENOENT")).toBe(false);
    expect(resetTime("resets in 2 minutes", 0)).toBe(120000);
  });
  it("humanizes cron and local times", () => {
    expect(humanCron("0 7 * * 1-5")).toBe("Weekdays at 7:00 AM");
    expect(humanCron("30 18 * * *")).toBe("Every day at 6:30 PM");
    expect(zonedToEpoch("2026-10-02T09:00", "America/Los_Angeles")).toBe(Date.parse("2026-10-02T16:00:00Z"));
    expect(zonedToEpoch("2026-12-02T09:00", "America/Los_Angeles")).toBe(Date.parse("2026-12-02T17:00:00Z"));
  });
  it("classifies connector tools", () => {
    expect(isReadTool("mcp__claude_ai_Gmail__search_threads")).toBe(true);
    expect(isReadTool("mcp__claude_ai_Gmail__send_email")).toBe(false);
    expect(isReadTool("mcp__claude_ai_Gmail__authenticate")).toBe(true);
    expect(isReadTool("Bash")).toBe(false);
    expect(describeTool("mcp__claude_ai_Gmail__send_email", { to: "x@y.z", subject: "Hi" }).title).toBe("Send an email");
    expect(describeTool("mcp__homeassistant__intent__HassTurnOn", { name: "Kitchen Light" }).title).toBe("Turn something on: Kitchen Light");
    expect(isReadTool("mcp__homeassistant__homeassistant__GetLiveContext")).toBe(true);
    expect(isReadTool("mcp__homeassistant__intent__HassTurnOff")).toBe(false);
  });
});

describe("chat", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await fetch(base + "/api/bootstrap");
    expect(res.status).toBe(401);
  });

  it("delivers, reads and replies in one bubble on opus/medium", async () => {
    const main = app.messages.mainThread();
    // Onboarding woke the agent for its intro; wait for that turn to finish.
    await until(() => app.session(main).alive && !app.session(main).busy);
    const sent = await api("POST", `/api/threads/${main}/messages`, { text: "hello there" });
    expect(sent.status).toBe(200);
    const msgId = sent.body.id;
    await until(() => app.messages.get(msgId)?.status === "read");
    const replies = await until(() => {
      const list = app.messages.list(main).filter((m) => m.role === "agent" && m.text.includes("hello there"));
      return list.length ? list : null;
    });
    expect(replies).toHaveLength(1);
    expect(replies[0].text).toMatch(/^echo: hello there[\s\S]*\n\nsecond thought/);
    const chatArgs = fs.readFileSync(argsLog, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((a: string[]) => a.includes("--input-format"));
    expect(chatArgs[chatArgs.indexOf("--model") + 1]).toBe("opus");
    expect(chatArgs[chatArgs.indexOf("--effort") + 1]).toBe("medium");
    expect(chatArgs).toContain("--replay-user-messages");
    expect(chatArgs[chatArgs.indexOf("--permission-prompt-tool") + 1]).toBe("mcp__kin__approve");
  });

  it("lets the agent react through MCP", async () => {
    const main = app.messages.mainThread();
    const sent = await api("POST", `/api/threads/${main}/messages`, { text: "react-test" });
    const m = await until(() => app.messages.get(sent.body.id)?.reactions.find((r) => r.by === "agent"));
    expect(m.emoji).toBe("👍");
  });

  it("can answer with only a reaction", async () => {
    const main = app.messages.mainThread();
    await until(() => !app.session(main).busy);
    const states: string[] = [];
    const listener = (e: any) => e.type === "agent.state" && e.data.threadId === main && states.push(e.data.state);
    app.bus.on("event", listener);
    const sent = await api("POST", `/api/threads/${main}/messages`, { text: "thanks! react-only" });
    await until(() => app.messages.get(sent.body.id)?.reactions.find((r) => r.by === "agent")?.emoji === "❤️");
    await until(() => states.includes("done"));
    app.bus.off("event", listener);
    expect(app.messages.get(sent.body.id)!.status).toBe("read");
    await new Promise((r) => setTimeout(r, 300));
    const after = app.messages.list(main, undefined, 200).filter((m) => m.createdAt > sent.body.createdAt && m.role === "agent");
    expect(after).toHaveLength(0); // no reply bubble
    expect(states).not.toContain("working");
    expect(states).not.toContain("typing");
  });

  it("toggles user tapbacks", async () => {
    const main = app.messages.mainThread();
    const agentMsg = app.messages.list(main).find((m) => m.role === "agent" && m.kind === "text")!;
    let r = await api("PUT", `/api/messages/${agentMsg.id}/reactions`, { emoji: "❤️" });
    expect(r.body.reactions).toEqual([{ emoji: "❤️", by: "user" }]);
    r = await api("PUT", `/api/messages/${agentMsg.id}/reactions`, { emoji: "❤️" });
    expect(r.body.reactions).toEqual([]);
  });

  it("shows an approval card and resumes with the decision", async () => {
    const main = app.messages.mainThread();
    await api("POST", `/api/threads/${main}/messages`, { text: "approve-test" });
    const card = await until(() => app.messages.list(main).find((m) => m.kind === "approval" && m.approval?.status === "pending"));
    expect(card.approval!.title).toBe("Send an email");
    expect(card.approval!.detail).toContain("to: a@b.c");
    const boot = await api("GET", "/api/bootstrap");
    expect(boot.body.pendingApprovals).toHaveLength(1);
    const r = await api("POST", `/api/approvals/${card.approval!.approvalId}`, { decision: "deny" });
    expect(r.status).toBe(200);
    await until(() => app.messages.list(main).some((m) => m.text === "approval: deny"));
    expect(app.messages.get(card.id)!.approval!.status).toBe("denied");
  });

  it("remembers 'Always allow'", async () => {
    const main = app.messages.mainThread();
    await api("POST", `/api/threads/${main}/messages`, { text: "approve-test again" });
    const card = await until(() => app.messages.list(main).find((m) => m.kind === "approval" && m.approval?.status === "pending"));
    await api("POST", `/api/approvals/${card.approval!.approvalId}`, { decision: "always" });
    await until(() => app.messages.list(main).filter((m) => m.text === "approval: allow").length === 1);
    await api("POST", `/api/threads/${main}/messages`, { text: "approve-test third" });
    await until(() => app.messages.list(main).filter((m) => m.text === "approval: allow").length === 2);
    expect(app.allowRules()).toContain("mcp__claude_ai_Gmail__send_email");
  });
});

describe("hardening", () => {
  it("serves untrusted HTML as an inert download", async () => {
    fs.writeFileSync(path.join(process.env.KIN_HOME!, "library", "evil.html"), "<script>alert(1)</script>");
    const res = await fetch(`${base}/api/library/raw?path=evil.html`, { headers: auth });
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
    const escape = await fetch(`${base}/api/library/raw?path=../memory.md`, { headers: auth });
    expect(escape.status).toBe(404);
  });

  it("rejects bad times without saving them", async () => {
    const before = app.settings().briefTime;
    const r = await api("PATCH", "/api/settings", { briefTime: "99:99" });
    expect(r.status).toBe(400);
    expect(app.settings().briefTime).toBe(before);
    const ok = await api("PATCH", "/api/settings", { briefTime: "00:30" });
    expect(ok.status).toBe(200);
    expect(app.scheduler.list().find((s) => s.title === "Morning brief")!.cron).toBe("30 0 * * *");
    await api("PATCH", "/api/settings", { briefTime: before });
  });

  it("returns 404 for unknown threads", async () => {
    expect((await api("GET", "/api/threads/nope/messages")).status).toBe(404);
  });
});

describe("background", () => {
  const runArgs = () =>
    fs.readFileSync(argsLog, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((a: string[]) => a[0] === "-p" && !a.includes("--input-format"));

  it("runs scheduled tasks silently on sonnet/medium", async () => {
    const main = app.messages.mainThread();
    const before = app.messages.list(main, undefined, 200).length;
    const s = app.scheduler.create({ title: "Price watch", kind: "task", prompt: "check prices quietly", cron: "0 9 * * *" });
    app.scheduler.run(s.id);
    const run = await until(() => app.store.get<any>("SELECT * FROM runs WHERE title='Price watch' AND status='ok'"));
    expect(run.model).toBe("sonnet");
    expect(run.effort).toBe("medium");
    const last = runArgs().pop()!;
    expect(last[last.indexOf("--model") + 1]).toBe("sonnet");
    expect(last[last.indexOf("--effort") + 1]).toBe("medium");
    expect(app.messages.list(main, undefined, 200).length).toBe(before);
  });

  it("surfaces only when the run calls send_message", async () => {
    const main = app.messages.mainThread();
    const s = app.scheduler.create({ title: "Inbox watch", kind: "task", prompt: "SURFACE if needed", cron: "0 9 * * *" });
    app.scheduler.run(s.id);
    const m = await until(() => app.messages.list(main).find((x) => x.text === "Heads up from the background"));
    expect(m.source).toBe("background");
  });

  it("start_task shows a live task card and reports back", async () => {
    const main = app.messages.mainThread();
    await api("POST", `/api/threads/${main}/messages`, { text: "task-test" });
    const card = await until(() => app.messages.list(main).find((m) => m.kind === "task" && m.task?.status === "ok"));
    expect(card.task!.result).toContain("summary: do the thing");
    expect(card.task!.steps.length).toBeGreaterThan(0);
  });

  it("delivers reminders without a model run", async () => {
    const main = app.messages.mainThread();
    const runsBefore = app.store.get<any>("SELECT COUNT(*) AS n FROM runs WHERE kind!='chat'").n;
    app.store.run("UPDATE schedules SET enabled=0");
    const s = app.scheduler.create({ title: "stretch", kind: "reminder", prompt: "stretch!", at: Date.now() + 100 });
    await new Promise((r) => setTimeout(r, 150));
    app.scheduler.tick();
    await until(() => app.messages.list(main).find((m) => m.kind === "reminder" && m.text === "stretch!"));
    expect(app.store.get<any>("SELECT COUNT(*) AS n FROM runs WHERE kind!='chat'").n).toBe(runsBefore);
    expect(app.scheduler.get(s.id)!.enabled).toBe(0);
  });

  it("pauses and requeues on plan limit", async () => {
    app.runner.start({ kind: "schedule", title: "Limited", prompt: "FAIL-LIMIT" });
    await until(() => app.pausedUntil() > Date.now());
    const run = app.store.get<any>("SELECT * FROM runs WHERE title='Limited'");
    expect(run.status).toBe("queued");
    expect((await api("GET", "/api/usage")).body.pausedUntil).toBeGreaterThan(Date.now());
  });

  it("never gives read-only runs the owner's 'Always' rules", async () => {
    const { launch } = await import("../src/claude/config.js");
    const ro = launch(app, { ctx: { threadId: "x", runId: "r_ro", kind: "heartbeat", readOnly: true }, model: "sonnet", effort: "medium", systemPrompt: "", stream: false });
    const rw = launch(app, { ctx: { threadId: "x", runId: "r_rw", kind: "task", readOnly: false }, model: "sonnet", effort: "medium", systemPrompt: "", stream: false });
    const allow = (l: typeof ro) => JSON.parse(fs.readFileSync(l.args[l.args.indexOf("--settings") + 1], "utf8")).permissions.allow;
    expect(allow(rw)).toContain("mcp__claude_ai_Gmail__send_email");
    expect(allow(ro)).not.toContain("mcp__claude_ai_Gmail__send_email");
    const denied = await app.approvals.request({ threadId: "x", runId: "r_ro", kind: "heartbeat", readOnly: true }, "mcp__claude_ai_Gmail__send_email", {});
    expect(denied.behavior).toBe("deny");
  });

  it("installs built-in jobs on onboarding", async () => {
    const list = (await api("GET", "/api/schedules")).body as any[];
    expect(list.map((s) => s.title)).toEqual(expect.arrayContaining(["Morning brief", "Memory consolidation"]));
  });
});
