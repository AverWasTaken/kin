import { Cron } from "croner";
import { id, now } from "./db.js";
import { BUILTIN_PROMPTS, localTime } from "./home.js";
import type { App } from "./app.js";
import type { Schedule, Settings } from "./shared/api.js";

interface Row {
  id: string;
  title: string;
  kind: "reminder" | "task" | "builtin" | "goal";
  builtin: string | null;
  cron: string | null;
  at: number | null;
  timezone: string;
  prompt: string;
  enabled: number;
  next_at: number | null;
  last_at: number | null;
  created_at: number;
}

export function nextRun(cron: string, timezone: string, after = new Date()) {
  const job = new Cron(cron, { timezone, paused: true });
  try {
    return job.nextRun(after)?.getTime() ?? null;
  } finally {
    job.stop();
  }
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function clock(h: number, m: number) {
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Plain-English cron for the common shapes; falls back to the expression. */
export function humanCron(cron: string): string {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = f;
  const m = Number(min);
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === "*" && mon === "*") {
    const t = clock(Number(hour), m);
    if (dow === "*") return `Every day at ${t}`;
    if (dow === "1-5") return `Weekdays at ${t}`;
    if (dow === "0,6" || dow === "6,0") return `Weekends at ${t}`;
    if (/^\d$/.test(dow)) return `Every ${DAYS[Number(dow) % 7]} at ${t}`;
    if (/^[\d,]+$/.test(dow)) return `${dow.split(",").map((d) => DAYS[Number(d) % 7].slice(0, 3)).join(", ")} at ${t}`;
  }
  if (/^\d+$/.test(min) && /^\*\/(\d+)$/.test(hour) && dom === "*" && mon === "*" && dow === "*")
    return `Every ${hour.slice(2)} hours`;
  if (/^\d+$/.test(min) && /^\d+-\d+\/\d+$/.test(hour) && dom === "*" && mon === "*" && dow === "*") {
    const [range, step] = hour.split("/");
    const [a, b] = range.split("-").map(Number);
    return `Every ${step} hours, ${clock(a, m)}–${clock(b, m)}`;
  }
  if (/^\d+$/.test(min) && /^[\d,]+$/.test(hour) && dom === "*" && mon === "*" && dow === "*")
    return `Daily at ${hour.split(",").map((h) => clock(Number(h), m)).join(", ")}`;
  if (/^\*\/(\d+)$/.test(min) && hour === "*") return `Every ${min.slice(2)} minutes`;
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && mon === "*" && dow === "*")
    return `Monthly on day ${dom} at ${clock(Number(hour), m)}`;
  return cron;
}

/** Parses "HH:MM" into a daily cron. */
export const dailyCron = (hhmm: string) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error(`Invalid time "${hhmm}" (use HH:MM)`);
  return `${Number(m[2])} ${Number(m[1])} * * *`;
};

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  constructor(readonly app: App) {}

  start() {
    this.timer = setInterval(() => this.tick(), 15_000);
    this.timer.unref();
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  toApi(r: Row): Schedule {
    return {
      id: r.id,
      title: r.title,
      kind: r.kind === "goal" ? "task" : r.kind,
      cron: r.cron,
      at: r.at,
      timezone: r.timezone,
      prompt: r.prompt,
      enabled: !!r.enabled,
      nextAt: r.next_at,
      lastAt: r.last_at,
      human: r.cron ? humanCron(r.cron) : r.at ? localTime(r.timezone, new Date(r.at)) : "",
    };
  }

  list(includeDisabled = true): Schedule[] {
    return this.app.store
      .all<Row>(`SELECT * FROM schedules ${includeDisabled ? "" : "WHERE enabled=1"} ORDER BY COALESCE(next_at, 9e15)`)
      .map((r) => this.toApi(r));
  }

  get(scheduleId: string) {
    return this.app.store.get<Row>("SELECT * FROM schedules WHERE id=?", scheduleId);
  }

  create(input: { title: string; kind: Row["kind"]; cron?: string | null; at?: number | null; timezone?: string; prompt: string; builtin?: string }) {
    const timezone = input.timezone ?? this.app.settings().timezone;
    if (!input.cron && !input.at) throw new Error("Give either a cron expression or a time");
    let next: number | null;
    if (input.cron) {
      next = nextRun(input.cron, timezone);
      if (!next) throw new Error("That cron expression never fires");
    } else {
      next = input.at!;
      if (next < now() - 60_000) throw new Error(`That time (${localTime(timezone, new Date(next))}) has already passed`);
    }
    const scheduleId = id("s_");
    this.app.store.run(
      "INSERT INTO schedules(id,title,kind,builtin,cron,at,timezone,prompt,enabled,next_at,created_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)",
      scheduleId,
      input.title,
      input.kind,
      input.builtin ?? null,
      input.cron ?? null,
      input.cron ? null : input.at,
      timezone,
      input.prompt,
      next,
      now(),
    );
    this.changed();
    return this.toApi(this.get(scheduleId)!);
  }

  setEnabled(scheduleId: string, enabled: boolean) {
    const r = this.get(scheduleId);
    if (!r) throw new Error("Unknown schedule");
    const next = enabled ? (r.cron ? nextRun(r.cron, r.timezone) : r.at && r.at > now() ? r.at : null) : r.next_at;
    this.app.store.run("UPDATE schedules SET enabled=?, next_at=? WHERE id=?", enabled && next ? 1 : 0, next, scheduleId);
    this.changed();
    return this.toApi(this.get(scheduleId)!);
  }

  remove(scheduleId: string) {
    const r = this.get(scheduleId);
    if (!r) return false;
    this.app.store.run("DELETE FROM schedules WHERE id=?", scheduleId);
    this.changed();
    return true;
  }

  private changed() {
    this.app.bus.publish("schedules.updated", {});
  }

  tick() {
    const t = now();
    for (const r of this.app.store.all<Row>("SELECT * FROM schedules WHERE enabled=1 AND next_at<=?", t)) {
      // Missed by more than 6h (server was down): skip recurring catch-up, but still deliver reminders.
      const stale = t - (r.next_at ?? t) > 6 * 3600_000 && !!r.cron;
      try {
        if (!stale) this.fire(r);
      } catch (e) {
        this.app.log("scheduler", `${r.id} failed: ${e}`);
      }
      const next = r.cron ? nextRun(r.cron, r.timezone) : null;
      this.app.store.run("UPDATE schedules SET last_at=?, next_at=?, enabled=? WHERE id=?", t, next, next ? 1 : 0, r.id);
      this.changed();
    }
  }

  run(scheduleId: string) {
    const r = this.get(scheduleId);
    if (!r) throw new Error("Unknown schedule");
    this.fire(r);
    this.app.store.run("UPDATE schedules SET last_at=? WHERE id=?", now(), scheduleId);
    this.changed();
  }

  private fire(r: Row) {
    const app = this.app;
    const main = app.messages.mainThread();
    const settings = app.settings();
    if (r.kind === "reminder") {
      app.messages.create({ threadId: main, role: "agent", kind: "reminder", text: r.prompt, source: "reminder" });
      app.session(main).note(`Reminder delivered to the user just now: "${r.prompt}"`);
      return;
    }
    if (r.kind === "task") {
      app.runner.start({ kind: "schedule", title: r.title, prompt: `Scheduled task "${r.title}" (${r.cron ? humanCron(r.cron) : "one-time"}):\n\n${r.prompt}` });
      return;
    }
    if (r.kind === "goal") {
      const goalId = r.builtin?.replace(/^goal:/, "") ?? "";
      const goal = app.store.get<any>("SELECT * FROM goals WHERE id=?", goalId);
      if (!goal || goal.status !== "active") return;
      app.store.run("UPDATE goals SET last_checkin_at=? WHERE id=?", now(), goalId);
      app.runner.start({
        kind: "goal",
        title: `Check-in: ${goal.title}`,
        prompt: `Goal check-in for "${goal.title}" (id ${goalId}, category ${goal.category}).\nWhy: ${goal.why}\nPlan: ${goal.plan}\nProgress: ${Math.round(goal.progress * 100)}%\nNotes: ${goal.notes}\n\nReview progress using what you can see (notes/, memory, connected apps). Update the goal with goal_update (progress, plan steps, notes). If a nudge or question would genuinely help the user today, send one short friendly message. Otherwise stay quiet.`,
      });
      return;
    }
    switch (r.builtin) {
      case "brief":
        app.runner.start({ kind: "brief", title: "Morning brief", prompt: BUILTIN_PROMPTS.brief });
        break;
      case "heartbeat":
        if (settings.proactivity === "off" || app.inQuietHours()) return;
        app.runner.start({ kind: "heartbeat", title: "Proactive check", prompt: BUILTIN_PROMPTS.heartbeat, readOnly: true });
        break;
      case "consolidate":
        app.runner.start({ kind: "consolidate", title: "Memory consolidation", prompt: `${BUILTIN_PROMPTS.consolidate}\n\n${app.dayDigest()}` });
        break;
    }
  }

  /** Keeps the built-in jobs in line with settings. */
  syncBuiltins(settings: Settings) {
    const want: Record<string, { title: string; cron: string | null }> = {
      brief: { title: "Morning brief", cron: dailyCron(settings.briefTime) },
      heartbeat: {
        title: "Proactive check",
        cron: settings.proactivity === "off" ? null : settings.proactivity === "more" ? "0 8-22/2 * * *" : "0 9,13,18 * * *",
      },
      consolidate: { title: "Memory consolidation", cron: "0 3 * * *" },
    };
    for (const [key, w] of Object.entries(want)) {
      const r = this.app.store.get<Row>("SELECT * FROM schedules WHERE kind='builtin' AND builtin=?", key);
      if (!r) {
        if (w.cron) this.create({ title: w.title, kind: "builtin", builtin: key, cron: w.cron, prompt: `(built-in: ${key})`, timezone: settings.timezone });
        continue;
      }
      if (!w.cron) {
        // Removed rather than disabled, so turning proactivity back on recreates it.
        this.app.store.run("DELETE FROM schedules WHERE id=?", r.id);
        continue;
      }
      if (r.cron !== w.cron || r.timezone !== settings.timezone)
        this.app.store.run(
          "UPDATE schedules SET cron=?, timezone=?, next_at=?, enabled=1 WHERE id=?",
          w.cron,
          settings.timezone,
          nextRun(w.cron, settings.timezone),
          r.id,
        );
    }
    this.changed();
  }

  /** Goal check-ins are schedules tied to the goal. */
  syncGoal(goalId: string, title: string, cron: string | null) {
    const key = `goal:${goalId}`;
    const r = this.app.store.get<Row>("SELECT * FROM schedules WHERE kind='goal' AND builtin=?", key);
    if (!cron) {
      if (r) this.remove(r.id);
      return;
    }
    if (r) {
      this.app.store.run(
        "UPDATE schedules SET cron=?, title=?, next_at=?, enabled=1 WHERE id=?",
        cron,
        `Check-in: ${title}`,
        nextRun(cron, r.timezone),
        r.id,
      );
      this.changed();
    } else this.create({ title: `Check-in: ${title}`, kind: "goal", builtin: key, cron, prompt: `(goal check-in)` });
  }
}
