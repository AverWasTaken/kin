import { useEffect, useState } from "react";
import type { Run, RunLogEntry } from "@shared/api";
import { api } from "../lib/client";
import { setKin, useKin } from "../lib/store";
import { useLastDefined } from "../lib/hooks";
import { clock, compactNumber, relative } from "../lib/time";
import { Sheet } from "../components/Sheet";
import { I } from "../components/Icons";
import { RUN_STATUS } from "./Profile";

function duration(run: Run) {
  if (!run.startedAt) return "Not started";
  const ms = (run.endedAt ?? Date.now()) - run.startedAt;
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

const LOG_ICON = { text: "Chat", tool: "Bolt", result: "Check", error: "X", status: "Clock" } as const;

export function RunDetail() {
  const current = useKin((s) => s.runDetail);
  const id = useLastDefined(current);
  const live = useKin((s) => (id ? s.runs[id] : undefined));
  const version = useKin((s) => s.versions.runs);
  const [data, setData] = useState<{ run: Run; log: RunLogEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!current) return;
    let alive = true;
    api
      .run(current)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [current, version]);

  const run = live ?? data?.run;
  const st = run ? RUN_STATUS[run.status] : null;
  const active = run && (run.status === "running" || run.status === "waiting" || run.status === "queued");

  return (
    <Sheet open={!!current} onClose={() => setKin({ runDetail: null })} title="Run" label={run?.title}>
      {error && !run && <div className="empty"><p>{error}</p></div>}
      {!run && !error && (
        <div className="viewer-loading">
          <span className="spinner" />
        </div>
      )}
      {run && st && (
        <div className="run-detail">
          <div className="run-hero">
            <span className={`pill ${st.cls}`}>
              {active && <span className="dot" />}
              {st.label}
            </span>
            <h2>{run.title}</h2>
            {run.summary && <p>{run.summary}</p>}
          </div>
          <div className="run-facts">
            <div>
              <span>Kind</span>
              <b>{run.kind}</b>
            </div>
            <div>
              <span>Started</span>
              <b>{run.startedAt ? relative(run.startedAt) : "—"}</b>
            </div>
            <div>
              <span>Took</span>
              <b>{duration(run)}</b>
            </div>
            <div>
              <span>Tokens</span>
              <b>{compactNumber(run.tokens)}</b>
            </div>
          </div>
          <div className="run-model">
            {run.model} · {run.effort} effort
          </div>
          {active && (
            <div className="group" style={{ margin: "0 0 18px" }}>
              <button
                type="button"
                className="btn btn-soft btn-block btn-danger"
                onClick={() => run.threadId && api.stop(run.threadId)}
              >
                <I.Stop size={16} /> Stop this run
              </button>
            </div>
          )}
          <h3 className="log-title">Log</h3>
          <ol className="run-log">
            {(data?.log ?? []).map((e, i) => {
              const Icon = I[LOG_ICON[e.type]];
              return (
                <li key={i} className={`log-${e.type}`}>
                  <span className="log-icon">
                    <Icon size={12} />
                  </span>
                  <span className="log-body">
                    <span className="log-time">{clock(e.at)}</span>
                    <span className="log-text">{e.text}</span>
                  </span>
                </li>
              );
            })}
            {data && data.log.length === 0 && <li className="muted">No log entries.</li>}
          </ol>
        </div>
      )}
    </Sheet>
  );
}
