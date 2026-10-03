import { spawn } from "node:child_process";
import fs from "node:fs";
import { env } from "../config.js";
import { id, now } from "../db.js";
import { backgroundPrompt } from "../home.js";
import type { App } from "../app.js";
import type { Run, RunKind, RunStatus, TaskMeta } from "../shared/api.js";
import { launch, models } from "./config.js";
import { parseLine, planLimit, resetTime, toolStatus } from "./parse.js";
import { executable, lineReader } from "./process.js";

export interface BackgroundJob {
  kind: RunKind;
  title: string;
  prompt: string;
  threadId?: string;
  /** Show a live task card in the thread (start_task). */
  card?: boolean;
  /** Connected apps are read-only for this run. */
  readOnly?: boolean;
  /** Post the final result into the main session as a note so the chat agent can follow up. */
  reportBack?: boolean;
}

/** One-shot background runs: always Sonnet at medium effort. */
export class Runner {
  private queue: string[] = [];
  private active = new Map<string, AbortController>();
  private jobs = new Map<string, BackgroundJob>();

  constructor(readonly app: App) {}

  start(job: BackgroundJob): Run {
    const { model, effort } = models.background();
    const runId = id("r_");
    const threadId = job.threadId ?? this.app.messages.mainThread();
    this.app.store.run(
      "INSERT INTO runs(id,kind,title,thread_id,status,model,effort,created_at,prompt) VALUES(?,?,?,?,?,?,?,?,?)",
      runId,
      job.kind,
      job.title,
      threadId,
      "queued",
      model,
      effort,
      now(),
      job.prompt,
    );
    if (job.card) {
      const task: TaskMeta = { runId, title: job.title, status: "queued", steps: [] };
      const msg = this.app.messages.create({ threadId, role: "agent", kind: "task", text: job.title, task, source: "background" });
      this.app.store.run("UPDATE runs SET message_id=? WHERE id=?", msg.id, runId);
    }
    this.jobs.set(runId, { ...job, threadId });
    this.queue.push(runId);
    this.publish(runId);
    this.pump();
    return this.get(runId)!;
  }

  get(runId: string): Run | undefined {
    const r = this.app.store.get<any>("SELECT * FROM runs WHERE id=?", runId);
    return (
      r && {
        id: r.id,
        kind: r.kind,
        title: r.title,
        threadId: r.thread_id,
        status: r.status,
        model: r.model,
        effort: r.effort,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        createdAt: r.created_at,
        summary: r.summary,
        tokens: r.tokens,
      }
    );
  }

  cancel(runId: string) {
    const i = this.queue.indexOf(runId);
    if (i >= 0) {
      this.queue.splice(i, 1);
      this.finish(runId, "aborted", "Cancelled", 0);
      return true;
    }
    const ctrl = this.active.get(runId);
    ctrl?.abort();
    return !!ctrl;
  }

  cancelAll() {
    for (const runId of [...this.queue]) this.cancel(runId);
    for (const ctrl of this.active.values()) ctrl.abort();
  }

  private pump() {
    if (this.app.pausedUntil() > now() || this.app.stopping) return;
    while (this.active.size < env.maxBackground && this.queue.length) {
      const runId = this.queue.shift()!;
      void this.execute(runId);
    }
  }

  resume() {
    this.pump();
  }

  private publish(runId: string) {
    const run = this.get(runId);
    if (run) this.app.bus.publish("run.updated", run);
  }

  private log(runId: string, type: string, text: string) {
    this.app.store.run("INSERT INTO run_log(run_id,at,type,text) VALUES(?,?,?,?)", runId, now(), type, text.slice(0, 4000));
  }

  private updateCard(runId: string, patch: Partial<TaskMeta>) {
    const row = this.app.store.get<{ message_id: string | null }>("SELECT message_id FROM runs WHERE id=?", runId);
    if (!row?.message_id) return;
    const msg = this.app.messages.get(row.message_id);
    if (!msg?.task) return;
    this.app.messages.update(row.message_id, { task: { ...msg.task, ...patch } });
  }

  private async execute(runId: string) {
    const job = this.jobs.get(runId)!;
    const ctrl = new AbortController();
    this.active.set(runId, ctrl);
    const { model, effort } = models.background();
    this.app.store.run("UPDATE runs SET status='running', started_at=? WHERE id=?", now(), runId);
    this.publish(runId);
    this.updateCard(runId, { status: "running" });
    const run = launch(this.app, {
      ctx: { threadId: job.threadId!, runId, kind: job.kind, readOnly: !!job.readOnly },
      model,
      effort,
      systemPrompt: backgroundPrompt(this.app.agent(), this.app.settings(), this.app.paths.home, job.kind),
      stream: false,
    });
    const spec = executable(env.claude);
    let final = "";
    let errors = "";
    let tokens = 0;
    let ok = false;
    const steps: string[] = [];
    const status = await new Promise<RunStatus>((resolve) => {
      const child = spawn(spec.command, [...spec.prefix, ...run.args], {
        cwd: this.app.paths.home,
        env: run.env,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
      let lastOutput = Date.now();
      let timedOut = false;
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch {}
      };
      const abort = () => {
        kill("SIGINT");
        setTimeout(() => kill("SIGKILL"), 3000).unref();
      };
      ctrl.signal.addEventListener("abort", abort, { once: true });
      const idle = setInterval(() => {
        // Waiting on an approval card is not idleness.
        if (this.app.approvals.waiting(runId)) lastOutput = Date.now();
        else if (Date.now() - lastOutput > 20 * 60_000) {
          timedOut = true;
          abort();
        }
      }, 5000);
      const feed = lineReader(
        (line) => {
          let data: unknown;
          try {
            data = JSON.parse(line);
          } catch {
            return;
          }
          for (const ev of parseLine(data)) {
            if (ev.type === "tool") {
              this.app.observeTool(ev.name);
              const s = toolStatus(ev.name, ev.input);
              this.log(runId, "tool", `${ev.name} ${JSON.stringify(ev.input).slice(0, 600)}`);
              if (s && steps[steps.length - 1] !== s) {
                steps.push(s);
                this.updateCard(runId, { steps: steps.slice(-8) });
              }
            } else if (ev.type === "text") this.log(runId, "text", ev.text);
            else if (ev.type === "init") this.app.setConnections(ev.mcp);
            else if (ev.type === "rate_limit") this.app.setRateLimit(ev);
            else if (ev.type === "result") {
              tokens += ev.tokens;
              ok = ev.ok;
              final = ev.text;
              this.log(runId, ev.ok ? "result" : "error", ev.text);
            }
          }
        },
        () => {
          errors += "stream line exceeded 2 MB\n";
          abort();
        },
      );
      child.stdout.on("data", (d) => {
        lastOutput = Date.now();
        feed(d);
      });
      child.stderr.on("data", (d) => {
        lastOutput = Date.now();
        errors = (errors + d.toString()).slice(-16000);
      });
      child.stdin.on("error", () => {});
      child.stdin.end(job.prompt);
      child.on("error", (e) => {
        errors += String(e);
      });
      child.on("close", (code) => {
        feed.flush();
        clearInterval(idle);
        this.app.tokens.delete(run.token);
        this.app.approvals.cancelForThread(job.threadId!, runId);
        for (const f of run.files) fs.rmSync(f, { force: true });
        if (ctrl.signal.aborted) resolve(timedOut ? "timeout" : "aborted");
        else resolve(code === 0 && ok ? "ok" : "error");
      });
    });
    this.active.delete(runId);
    const limited = status === "error" && planLimit(`${errors}\n${final}`);
    if (limited) {
      // Requeue once the plan resets instead of failing the job.
      this.app.pause(resetTime(`${errors}\n${final}`));
      this.app.store.run("UPDATE runs SET status='queued' WHERE id=?", runId);
      this.queue.unshift(runId);
      this.publish(runId);
      return;
    }
    const summary = status === "ok" ? final : final || errors.trim().split("\n").slice(-3).join("\n") || status;
    this.finish(runId, status, summary, tokens);
    this.pump();
  }

  private finish(runId: string, status: RunStatus, summary: string, tokens: number) {
    const job = this.jobs.get(runId);
    this.jobs.delete(runId);
    this.app.store.run(
      "UPDATE runs SET status=?, ended_at=?, summary=?, tokens=tokens+? WHERE id=?",
      status,
      now(),
      summary.slice(0, 8000),
      tokens,
      runId,
    );
    this.publish(runId);
    this.updateCard(runId, { status, result: summary.slice(0, 4000) });
    this.app.bus.publish("usage.updated", this.app.usage());
    if (!job) return;
    const threadExists = !!job.threadId && !!this.app.store.get("SELECT 1 FROM threads WHERE id=?", job.threadId);
    if (job.reportBack && threadExists && status !== "aborted" && !this.app.stopping) {
      const what = status === "ok" ? `finished:\n${summary.slice(0, 6000)}` : `ended with status ${status}: ${summary.slice(0, 1000)}`;
      this.app.session(job.threadId!).note(
        `Background task "${job.title}" (${runId}) ${what}\nThe user can see the task card with this result. Follow up briefly only if there's something to add or decide.`,
        true,
      );
    }
    if (job.card && status !== "aborted") this.app.push.send({ title: job.title, body: status === "ok" ? "Done" : `Task ${status}`, kind: "tasks" });
  }
}
