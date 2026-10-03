import fs from "node:fs";
import path from "node:path";
import { Approvals } from "./approvals.js";
import { Bus } from "./bus.js";
import { env, loadSecrets, type Paths, type Secrets } from "./config.js";
import { id, json, now, parse, Store } from "./db.js";
import { ensureHome, identityMd, localTime, memorySeed, writeMemory } from "./home.js";
import { Messages } from "./messages.js";
import { Push } from "./push.js";
import { dailyCron, Scheduler } from "./scheduler.js";
import { MainSession } from "./claude/session.js";
import { Runner } from "./claude/runner.js";
import { runCommand } from "./claude/process.js";
import type { RunContext } from "./claude/config.js";
import type { AgentInfo, Connection, Goal, OnboardingInput, RunKind, Settings, Usage } from "./shared/api.js";

const DEFAULT_SETTINGS: Settings = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  proactivity: "less",
  quietHours: { start: "22:30", end: "07:00" },
  briefTime: "07:00",
  notifications: { messages: true, approvals: true, tasks: true },
  askBeforeActing: true,
};

const DEFAULT_AGENT: AgentInfo = {
  name: "Kin",
  tagline: "always around",
  avatar: { shape: "bean", color: "#6C9BF2", accessory: "none", eyes: "dot" },
};

class Goals {
  constructor(readonly app: App) {}
  private toApi(r: any): Goal {
    return {
      id: r.id,
      title: r.title,
      category: r.category,
      why: r.why,
      plan: parse(r.plan, []),
      progress: r.progress,
      checkin: r.checkin,
      lastCheckinAt: r.last_checkin_at,
      notes: r.notes,
      status: r.status,
      createdAt: r.created_at,
    };
  }
  list(): Goal[] {
    return this.app.store.all("SELECT * FROM goals ORDER BY status='done', created_at DESC").map((r) => this.toApi(r));
  }
  get(goalId: string) {
    const r = this.app.store.get("SELECT * FROM goals WHERE id=?", goalId);
    return r && this.toApi(r);
  }
  patch(goalId: string, p: Partial<Omit<Goal, "id" | "createdAt">>) {
    const g = this.get(goalId);
    if (!g) throw new Error("Unknown goal");
    const next = { ...g, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } as Goal;
    if (p.plan && p.progress === undefined && next.plan.length) next.progress = next.plan.filter((s) => s.done).length / next.plan.length;
    this.app.store.run(
      "UPDATE goals SET title=?, category=?, why=?, plan=?, progress=?, checkin=?, notes=?, status=? WHERE id=?",
      next.title,
      next.category,
      next.why,
      json(next.plan),
      Math.max(0, Math.min(1, next.progress)),
      next.checkin,
      next.notes,
      next.status,
      goalId,
    );
    if (p.checkin !== undefined || p.status !== undefined || p.title !== undefined)
      this.app.scheduler.syncGoal(goalId, next.title, next.status === "active" ? next.checkin : null);
    this.app.bus.publish("goals.updated", {});
    return this.get(goalId)!;
  }
  remove(goalId: string) {
    this.app.scheduler.syncGoal(goalId, "", null);
    this.app.store.run("DELETE FROM goals WHERE id=?", goalId);
    this.app.bus.publish("goals.updated", {});
  }
}

export class App {
  readonly secrets: Secrets;
  readonly store: Store;
  readonly bus: Bus;
  readonly messages: Messages;
  readonly runner: Runner;
  readonly approvals: Approvals;
  readonly scheduler: Scheduler;
  readonly push: Push;
  readonly goals: Goals;
  readonly tokens = new Map<string, RunContext>();
  readonly sessions = new Map<string, MainSession>();
  /** Work held back while the plan limit is exhausted. */
  readonly deferred: (() => void)[] = [];
  /** Connected clients that report the app is on screen. */
  clients = 0;
  stopping = false;
  private connectionTimer: NodeJS.Timeout | null = null;
  private resumeTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly paths: Paths,
    readonly port = env.port,
  ) {
    fs.mkdirSync(paths.data, { recursive: true, mode: 0o700 });
    ensureHome(paths.home);
    this.secrets = loadSecrets(paths);
    this.store = new Store(path.join(paths.data, "kin.db"));
    this.bus = new Bus(this.store);
    this.messages = new Messages(this);
    this.runner = new Runner(this);
    this.approvals = new Approvals(this);
    this.scheduler = new Scheduler(this);
    this.push = new Push(this);
    this.goals = new Goals(this);
  }

  start() {
    this.push.init();
    this.approvals.expireOrphans();
    // Runs that were active when the server stopped can't be resumed.
    for (const r of this.store.all<{ id: string; message_id: string | null }>("SELECT id, message_id FROM runs WHERE status IN ('queued','running','waiting')")) {
      this.store.run("UPDATE runs SET status='error', ended_at=?, summary='Interrupted by a server restart' WHERE id=?", now(), r.id);
      const card = r.message_id ? this.messages.get(r.message_id) : undefined;
      if (card?.task) this.messages.update(card.id, { task: { ...card.task, status: "error", result: "Interrupted by a server restart" } });
    }
    this.messages.mainThread();
    try {
      if (this.onboarded()) this.scheduler.syncBuiltins(this.settings());
    } catch (e) {
      this.log("scheduler", `built-in jobs not synced: ${e}`);
    }
    this.scheduler.start();
    if (this.pausedUntil() > now()) this.scheduleResume();
    void this.checkConnections();
    this.connectionTimer = setInterval(() => void this.checkConnections(), 3600_000);
    this.connectionTimer.unref();
  }

  stop() {
    this.stopping = true;
    this.scheduler.stop();
    if (this.connectionTimer) clearInterval(this.connectionTimer);
    this.runner.cancelAll();
    for (const s of this.sessions.values()) s.stop();
  }

  log(scope: string, message: string) {
    console.log(`${new Date().toISOString()} [${scope}] ${message}`);
  }

  session(threadId: string) {
    let s = this.sessions.get(threadId);
    if (!s) {
      s = new MainSession(this, threadId);
      this.sessions.set(threadId, s);
    }
    return s;
  }

  settings(): Settings {
    const s = this.store.kv<Partial<Settings>>("settings", {});
    return { ...DEFAULT_SETTINGS, ...s, notifications: { ...DEFAULT_SETTINGS.notifications, ...(s.notifications ?? {}) } };
  }

  setSettings(patch: Partial<Settings>) {
    const next = { ...this.settings(), ...patch };
    // Validate everything that feeds a cron before saving, so a bad value can't brick startup.
    new Intl.DateTimeFormat("en-US", { timeZone: next.timezone });
    dailyCron(next.briefTime);
    if (next.quietHours) for (const t of [next.quietHours.start, next.quietHours.end]) dailyCron(t);
    this.store.setKv("settings", next);
    if (this.onboarded()) this.scheduler.syncBuiltins(next);
    for (const s of this.sessions.values()) s.refresh();
    return next;
  }

  agent(): AgentInfo {
    const a = this.store.kv<Partial<AgentInfo>>("agent", {});
    return { ...DEFAULT_AGENT, ...a, avatar: { ...DEFAULT_AGENT.avatar, ...(a.avatar ?? {}) } };
  }

  setAgent(patch: Partial<AgentInfo>) {
    const next = { ...this.agent(), ...patch, avatar: { ...this.agent().avatar, ...(patch.avatar ?? {}) } };
    this.store.setKv("agent", next);
    writeMemory(this.paths.home, "identity", identityMd(next));
    for (const s of this.sessions.values()) s.refresh();
    return next;
  }

  onboarded() {
    return this.store.kv("onboarded", false);
  }

  onboard(input: OnboardingInput) {
    this.store.setKv("settings", { ...this.settings(), timezone: input.timezone });
    this.setAgent({ name: input.agentName.trim() || "Kin", avatar: input.avatar });
    writeMemory(this.paths.home, "memory", memorySeed(input));
    const first = !this.onboarded();
    this.store.setKv("onboarded", true);
    this.scheduler.syncBuiltins(this.settings());
    if (first) {
      // Let the agent introduce itself in its own words.
      const main = this.messages.mainThread();
      this.session(main).note(
        `The user just finished setting you up in the app and is looking at the chat now. Introduce yourself in one short message: your name, what you can do for them (errands, research, reminders, a morning brief at ${this.settings().briefTime}, keeping track of goals, their smart home if Home Assistant is connected), and suggest 2–3 concrete first things based on what you know about them. Check which connectors work (ToolSearch for gmail/calendar) and, if Google isn't authorized yet, offer to set it up.`,
        true,
      );
    }
  }

  allowRules(): string[] {
    return this.store.kv<string[]>("allowRules", []);
  }

  addAllowRule(tool: string) {
    const rules = new Set(this.allowRules());
    rules.add(tool);
    this.store.setKv("allowRules", [...rules]);
  }

  // ---- connections -------------------------------------------------------

  connections(): Connection[] {
    return this.store.kv<Connection[]>("connections", []);
  }

  setConnections(servers: { name: string; status: string }[]) {
    const current = new Map(this.connections().map((c) => [c.id, c]));
    for (const s of servers) {
      const prev = current.get(s.name);
      if (s.status === "connected") current.set(s.name, { id: s.name, name: s.name.replace(/^claude\.ai /, ""), status: prev?.status === "needs_auth" ? "needs_auth" : "connected" });
      else if (s.status === "failed") current.set(s.name, { id: s.name, name: s.name.replace(/^claude\.ai /, ""), status: "error" });
    }
    this.store.setKv("connections", [...current.values()]);
  }

  async checkConnections() {
    try {
      const r = await runCommand(env.claude, ["mcp", "list"], 90_000, process.env, this.paths.home);
      const list: Connection[] = [];
      for (const line of r.output.split(/\r?\n/)) {
        const m = line.match(/^(.+?): \S+.* - (.+)$/);
        if (!m || /^Checking/.test(line)) continue;
        if (/Claude Docs/i.test(m[1])) continue;
        const ok = /connected/i.test(m[2]) && !/not|fail/i.test(m[2]);
        list.push({
          id: m[1],
          name: m[1].replace(/^claude\.ai /, ""),
          status: /auth/i.test(m[2]) ? "needs_auth" : ok ? "connected" : "error",
          detail: m[2].replace(/^[^\w]+/, ""),
        });
      }
      const prev = new Map(this.connections().map((c) => [c.id, c]));
      // "Connected" from mcp list means reachable; keep a needs_auth we observed from tool use.
      for (const c of list) if (prev.get(c.id)?.status === "needs_auth" && c.status === "connected") c.status = "needs_auth";
      list.push({
        id: "homeassistant",
        name: "Home Assistant",
        status: this.secrets.haToken ? "connected" : "needs_auth",
        detail: this.secrets.haToken ? "MCP server" : "Run: kin secret ha <token>",
      });
      this.store.setKv("connections", list);
    } catch (e) {
      this.log("connections", String(e));
    }
  }

  /** Tool use tells us more than `mcp list`: an authenticate-only connector isn't authorized. */
  observeTool(name: string) {
    const m = name.match(/^mcp__claude_ai_(.+?)__(.+)$/);
    if (!m) return;
    const label = m[1].replace(/_/g, " ");
    const list = this.connections();
    const c = list.find((x) => x.name.toLowerCase() === label.toLowerCase());
    if (!c) return;
    const status = /^authenticate$/.test(m[2]) ? "needs_auth" : /^complete_authentication$/.test(m[2]) ? "connected" : "connected";
    if (c.status !== status) {
      c.status = status;
      this.store.setKv("connections", list);
    }
  }

  // ---- usage & plan limits ------------------------------------------------

  recordChatTurn(threadId: string, startedAt: number, tokens: number, ok: boolean) {
    this.store.run(
      "INSERT INTO runs(id,kind,title,thread_id,status,model,effort,started_at,ended_at,created_at,tokens) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      id("r_"),
      "chat",
      "Conversation",
      threadId,
      ok ? "ok" : "error",
      env.chatModel,
      env.chatEffort,
      startedAt,
      now(),
      startedAt,
      tokens,
    );
    this.bus.publish("usage.updated", this.usage());
  }

  setRateLimit(r: { window: string; utilization: number; resetsAt: number; status: string }) {
    this.store.setKv("rateLimit", { window: r.window, utilization: r.utilization, resetsAt: r.resetsAt });
  }

  usage(): Usage {
    const day = now() - 86400_000;
    const week = now() - 7 * 86400_000;
    const agg = (since: number) =>
      this.store.get<{ runs: number; tokens: number }>("SELECT COUNT(*) AS runs, COALESCE(SUM(tokens),0) AS tokens FROM runs WHERE created_at>=?", since)!;
    return {
      today: agg(day),
      week: agg(week),
      byKind: this.store.all<{ kind: RunKind; runs: number; tokens: number }>(
        "SELECT kind, COUNT(*) AS runs, COALESCE(SUM(tokens),0) AS tokens FROM runs WHERE created_at>=? GROUP BY kind ORDER BY tokens DESC",
        week,
      ),
      rateLimit: this.store.kv("rateLimit", null),
      pausedUntil: this.pausedUntil() > now() ? this.pausedUntil() : null,
    };
  }

  pausedUntil() {
    return this.store.kv<number>("pausedUntil", 0);
  }

  pause(until: number) {
    this.store.setKv("pausedUntil", until);
    this.bus.publish("usage.updated", this.usage());
    this.scheduleResume();
  }

  private scheduleResume() {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.store.setKv("pausedUntil", 0);
      this.bus.publish("usage.updated", this.usage());
      for (const fn of this.deferred.splice(0)) fn();
      this.runner.resume();
    }, Math.max(1000, this.pausedUntil() - now() + 5000));
    this.resumeTimer.unref();
  }

  // ---- helpers --------------------------------------------------------------

  notice(threadId: string, text: string) {
    this.messages.create({ threadId, role: "system", kind: "notice", text });
  }

  formatTime(at: number) {
    return new Date(at).toLocaleTimeString("en-US", { timeZone: this.settings().timezone, hour: "numeric", minute: "2-digit" });
  }

  inQuietHours(at = new Date()) {
    const q = this.settings().quietHours;
    if (!q) return false;
    const hm = at.toLocaleTimeString("en-GB", { timeZone: this.settings().timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return q.start <= q.end ? hm >= q.start && hm < q.end : hm >= q.start || hm < q.end;
  }

  clientsOnline() {
    return this.clients > 0;
  }

  /** Context for nightly consolidation: today's conversation and 👎 reactions. */
  dayDigest() {
    const since = now() - 86400_000;
    const rows = this.store.all<any>(
      "SELECT role, kind, text, reactions, created_at FROM messages WHERE created_at>=? AND kind IN ('text','reminder') ORDER BY created_at",
      since,
    );
    const tz = this.settings().timezone;
    let transcript = rows
      .map((r) => `[${localTime(tz, new Date(r.created_at))}] ${r.role === "user" ? "User" : this.agent().name}: ${r.text.slice(0, 600)}`)
      .join("\n");
    if (transcript.length > 24000) transcript = `…${transcript.slice(-24000)}`;
    const thumbsDown = rows
      .filter((r) => parse<any[]>(r.reactions, []).some((x) => x.by === "user" && x.emoji === "👎"))
      .map((r) => `- "${r.text.slice(0, 300)}"`);
    return `## Today's conversation\n${transcript || "(none)"}\n\n## Messages the user reacted 👎 to\n${thumbsDown.join("\n") || "(none)"}`;
  }
}

export function createApp(paths: Paths, port?: number) {
  return new App(paths, port);
}
