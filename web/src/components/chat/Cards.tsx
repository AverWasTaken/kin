import { memo, useState } from "react";
import type { Message } from "@shared/api";
import { I } from "../Icons";
import { Markdown } from "../Markdown";
import { decideApproval } from "../../lib/actions";
import { clock } from "../../lib/time";
import { ReactionChips } from "./Bubble";

/* ----------------------------------------------------------------- Task */
/* Cards change in place (steps, status, result). Those updates are plain re-renders with
   small CSS fades: no layout animations, so the list around them is never re-measured. */

function TaskCardImpl({ m, onOpen }: { m: Message; onOpen: (runId: string) => void }) {
  const task = m.task!;
  const running = task.status === "running" || task.status === "queued" || task.status === "waiting";
  const failed = task.status === "error" || task.status === "aborted" || task.status === "timeout";
  const done = task.status === "ok";
  const expected = Math.max(task.steps.length + (running ? 1 : 0), 1);
  const progress = done ? 1 : running ? Math.min(0.92, task.steps.length / (expected + 0.5)) : task.steps.length / expected;

  return (
    <button
      type="button"
      className={`card task-card ${done ? "is-done" : ""} ${failed ? "is-failed" : ""}`}
      onClick={() => onOpen(task.runId)}
      aria-label={`Task: ${task.title}, ${task.status}`}
    >
      <div className="task-head">
        <span className="task-status" aria-hidden="true">
          {running ? (
            <span className="task-spinner" />
          ) : (
            <span className={`task-check pop-in ${failed ? "bad" : ""}`}>{failed ? <I.X size={14} /> : <I.Check size={14} />}</span>
          )}
        </span>
        <span className="task-titles">
          <span className="task-kicker">{running ? "Working in the background" : done ? "Done" : task.status === "aborted" ? "Stopped" : "Didn't finish"}</span>
          <span className="task-title">{task.title}</span>
        </span>
        <I.ChevronRight size={16} className="task-chev" />
      </div>

      <div className="task-bar" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>

      {done && task.result ? (
        <div className="task-result fade-in">
          <Markdown text={task.result} />
        </div>
      ) : (
        <ol className="task-steps">
          {task.steps.map((s, i) => {
            const active = running && i === task.steps.length - 1;
            return (
              <li key={s} className={`fade-in ${active ? "active" : "done"}`}>
                <span className="step-dot" aria-hidden="true">
                  {active ? <span className="pulse" /> : <I.Check size={11} />}
                </span>
                {s}
              </li>
            );
          })}
        </ol>
      )}
    </button>
  );
}
export const TaskCard = memo(TaskCardImpl);

/* ------------------------------------------------------------- Approval */

const OUTCOME: Record<string, { label: string; cls: string }> = {
  allowed: { label: "Allowed once", cls: "ok" },
  always: { label: "Always allowed", cls: "ok" },
  denied: { label: "Denied", cls: "err" },
  expired: { label: "Expired", cls: "" },
};

function formatInput(input: unknown) {
  if (input == null) return "";
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function ApprovalCardImpl({ m, agentName }: { m: Message; agentName: string }) {
  const ap = m.approval!;
  const pending = ap.status === "pending";
  const [showInput, setShowInput] = useState(false);
  const raw = formatInput(ap.input);

  return (
    <section className={`card approval-card ${pending ? "pending" : "resolved"}`} id={`ap-${ap.approvalId}`} aria-label="Permission request">
      <div className="ap-head">
        <span className="ap-shield">
          <I.Shield size={18} />
        </span>
        <span className="ap-titles">
          <span className="ap-kicker">{agentName} wants permission</span>
          <span className="ap-title">{ap.title}</span>
        </span>
      </div>

      <div className="ap-tool">
        <span className="ap-tool-name">{ap.tool}</span>
        <span className="ap-time">{clock(m.createdAt)}</span>
      </div>

      <pre className="ap-detail">{ap.detail}</pre>

      {raw && (
        <div>
          <button type="button" className="ap-raw-toggle" onClick={() => setShowInput((v) => !v)} aria-expanded={showInput}>
            <I.ChevronRight size={13} style={{ transform: showInput ? "rotate(90deg)" : undefined, transition: "transform .2s" }} />
            Exact input
          </button>
          {showInput && <pre className="ap-raw fade-in">{raw}</pre>}
        </div>
      )}

      {pending ? (
        <div className="ap-actions">
          <button type="button" className="ap-btn deny" onClick={() => decideApproval(m, "deny")}>
            Deny
          </button>
          <button type="button" className="ap-btn always" onClick={() => decideApproval(m, "always")}>
            Always
          </button>
          <button type="button" className="ap-btn once" onClick={() => decideApproval(m, "once")}>
            Allow once
          </button>
        </div>
      ) : (
        <div className={`ap-outcome fade-in ${OUTCOME[ap.status]?.cls ?? ""}`}>
          {ap.status === "denied" ? <I.X size={14} /> : ap.status === "expired" ? <I.Clock size={14} /> : <I.Check size={14} />}
          {OUTCOME[ap.status]?.label ?? ap.status}
        </div>
      )}
    </section>
  );
}
export const ApprovalCard = memo(ApprovalCardImpl);

/* ------------------------------------------------------------- Reminder */

export const ReminderCard = memo(function ReminderCard({ m }: { m: Message }) {
  const [title, ...rest] = m.text.split("\n");
  return (
    <div className={`card reminder-card ${m.reactions.length ? "has-reaction" : ""}`}>
      <span className="rem-bell" aria-hidden="true">
        <I.Bell size={18} />
      </span>
      <span className="rem-text">
        <span className="rem-kicker">Reminder set</span>
        <span className="rem-title">{title}</span>
        {rest.length > 0 && <span className="rem-when">{rest.join(" ")}</span>}
      </span>
      <ReactionChips reactions={m.reactions} side="agent" />
    </div>
  );
});

export const NoticeRow = memo(function NoticeRow({ m }: { m: Message }) {
  return <div className="notice">{m.text}</div>;
});
