import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Goal } from "@shared/api";
import { api } from "../lib/client";
import { askAgent } from "../lib/actions";
import { toast, useKin } from "../lib/store";
import { useResource } from "../lib/useResource";
import { cronHuman } from "../lib/cron";
import { relative } from "../lib/time";
import { useLastDefined } from "../lib/hooks";
import { I, type IconName } from "../components/Icons";
import { ProgressRing } from "../components/Controls";
import { Sheet } from "../components/Sheet";
import { Markdown } from "../components/Markdown";
import { TabScreen } from "../components/TabScreen";

export const CATEGORY: Record<Goal["category"], { label: string; icon: IconName; color: string }> = {
  health: { label: "Health", icon: "Heart", color: "#E5484D" },
  finance: { label: "Money", icon: "Wallet", color: "#2A9A68" },
  career: { label: "Career", icon: "Briefcase", color: "#3D84D6" },
  relationships: { label: "People", icon: "People", color: "#E3739D" },
  productivity: { label: "Focus", icon: "Bolt", color: "#D9A21B" },
  learning: { label: "Learning", icon: "Grad", color: "#8B6FD6" },
  home: { label: "Home", icon: "Home", color: "#C8743A" },
  other: { label: "Other", icon: "Sparkle", color: "#8A8378" },
};

const ORDER: Goal["category"][] = ["health", "finance", "career", "learning", "relationships", "productivity", "home", "other"];

function GoalRow({ g, onOpen }: { g: Goal; onOpen: () => void }) {
  const c = CATEGORY[g.category] ?? CATEGORY.other;
  const done = g.plan.filter((s) => s.done).length;
  return (
    <button type="button" className={`goal-row ${g.status}`} onClick={onOpen}>
      <span className="goal-ring">
        <ProgressRing value={g.progress} size={46} stroke={4.5} color={c.color} />
        <span className="goal-pct">{g.status === "done" ? <I.Check size={16} /> : `${Math.round(g.progress * 100)}`}</span>
      </span>
      <span className="row-main">
        <span className="goal-title">{g.title}</span>
        <span className="goal-sub">
          {g.status === "paused" ? (
            <span className="pill">
              <I.Pause size={9} /> Paused
            </span>
          ) : g.status === "done" ? (
            <span className="pill ok">Done</span>
          ) : null}
          <span>
            {done} of {g.plan.length} steps
          </span>
          {g.checkin && g.status === "active" && <span>· {cronHuman(g.checkin).replace(/ at .*/, "")}</span>}
        </span>
      </span>
      <I.ChevronRight size={16} className="chev" />
    </button>
  );
}

function GoalSheet({ goal: current, onClose, onChange }: { goal: Goal | null; onClose: () => void; onChange: (g: Goal) => void }) {
  const goal = useLastDefined(current);
  const [notes, setNotes] = useState(goal?.notes ?? "");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setNotes(goal?.notes ?? "");
    setEditing(false);
  }, [goal?.id, goal?.notes]);

  const patch = async (p: Partial<Goal>) => {
    if (!goal) return;
    const next = { ...goal, ...p };
    if (p.plan) next.progress = p.plan.filter((s) => s.done).length / Math.max(1, p.plan.length);
    onChange(next);
    try {
      await api.patchGoal(goal.id, p);
    } catch {
      onChange(goal);
      toast("Couldn't save the goal");
    }
  };

  const c = goal ? (CATEGORY[goal.category] ?? CATEGORY.other) : CATEGORY.other;
  const Icon = I[c.icon];

  return (
    <Sheet open={!!current} onClose={onClose} title={c.label} label={goal?.title}>
      {goal && (
        <div className="goal-sheet">
          <div className="goal-hero">
            <span className="goal-hero-ring">
              <ProgressRing value={goal.progress} size={92} stroke={7} color={c.color} />
              <span className="goal-hero-icon" style={{ color: c.color }}>
                <Icon size={30} />
              </span>
            </span>
            <h2>{goal.title}</h2>
            {goal.why && <p className="goal-why">{goal.why}</p>}
            <div className="goal-pct-big">{Math.round(goal.progress * 100)}% there</div>
          </div>

          <div className="group">
            <div className="group-title">Plan</div>
            <div className="group-body">
              {goal.plan.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  className={`row check-row ${s.done ? "done" : ""}`}
                  role="checkbox"
                  aria-checked={s.done}
                  onClick={() => patch({ plan: goal.plan.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })}
                >
                  <span className="check-box" style={{ "--c": c.color } as React.CSSProperties}>
                    <AnimatePresence>
                      {s.done && (
                        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 600, damping: 20 }}>
                          <I.Check size={13} />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </span>
                  <span className="row-main row-title">{s.step}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="group">
            <div className="group-title">
              Notes
              {!editing ? (
                <button type="button" className="btn-plain btn" onClick={() => setEditing(true)}>
                  Edit
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-plain btn"
                  onClick={() => {
                    setEditing(false);
                    if (notes !== goal.notes) patch({ notes });
                  }}
                >
                  Save
                </button>
              )}
            </div>
            <div className="group-body notes-body">
              {editing ? (
                <textarea className="notes-input" value={notes} autoFocus rows={5} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
              ) : goal.notes ? (
                <Markdown text={goal.notes} />
              ) : (
                <p className="muted">No notes yet.</p>
              )}
            </div>
          </div>

          <div className="group">
            <div className="group-title">Check-ins</div>
            <div className="group-body">
              <div className="row">
                <span className="row-main">
                  <span className="row-title">{cronHuman(goal.checkin)}</span>
                  {goal.lastCheckinAt && <span className="row-sub">Last check-in {relative(goal.lastCheckinAt)}</span>}
                </span>
              </div>
              <button type="button" className="row" onClick={() => askAgent(`Let's check in on my goal: ${goal.title}`).then(onClose)}>
                <span className="row-main row-title accent">Check in now</span>
              </button>
            </div>
          </div>

          <div className="goal-actions">
            {goal.status !== "done" && (
              <button type="button" className="btn btn-soft" onClick={() => patch({ status: goal.status === "paused" ? "active" : "paused" })}>
                {goal.status === "paused" ? (
                  <>
                    <I.Play size={15} /> Resume
                  </>
                ) : (
                  <>
                    <I.Pause size={15} /> Pause
                  </>
                )}
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => patch({ status: goal.status === "done" ? "active" : "done", progress: goal.status === "done" ? goal.progress : 1 })}>
              <I.Check size={16} /> {goal.status === "done" ? "Reopen" : "Mark complete"}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function Goals() {
  const version = useKin((s) => s.versions.goals);
  const agentName = useKin((s) => s.agent.name);
  const { data, setData } = useResource(() => api.goals(), version);
  const [openId, setOpenId] = useState<string | null>(null);
  const goals = useMemo(() => data ?? [], [data]);
  const open = goals.find((g) => g.id === openId) ?? null;

  const groups = useMemo(() => {
    const by = new Map<Goal["category"], Goal[]>();
    for (const g of goals) by.set(g.category, [...(by.get(g.category) ?? []), g]);
    return ORDER.filter((c) => by.has(c)).map((c) => ({ c, goals: by.get(c)! }));
  }, [goals]);

  const active = goals.filter((g) => g.status === "active");
  const avg = active.length ? active.reduce((n, g) => n + g.progress, 0) / active.length : 0;

  return (
    <TabScreen
      eyebrow={data ? `${active.length} active · ${Math.round(avg * 100)}% average` : " "}
      title="Goals"
      after={
        <GoalSheet
          goal={open}
          onClose={() => setOpenId(null)}
          onChange={(g) => setData((d) => (d ? d.map((x) => (x.id === g.id ? g : x)) : d))}
        />
      }
    >

        {data && goals.length === 0 && (
          <div className="empty">
            <h3>No goals yet</h3>
            <p>Tell {agentName} something you want to get done. It'll make a plan and check in with you.</p>
            <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => askAgent("I want to set a new goal")}>
              Set a goal
            </button>
          </div>
        )}

        {groups.map(({ c, goals: list }) => {
          const meta = CATEGORY[c];
          const Icon = I[meta.icon];
          return (
            <section key={c} className="group">
              <div className="group-title cat-title">
                <span className="cat-label">
                  <span className="cat-icon" style={{ background: meta.color }}>
                    <Icon size={13} />
                  </span>
                  {meta.label}
                </span>
              </div>
              <div className="group-body">
                {list.map((g) => (
                  <GoalRow key={g.id} g={g} onOpen={() => setOpenId(g.id)} />
                ))}
              </div>
            </section>
          );
        })}

        {goals.length > 0 && (
          <div className="group">
            <button type="button" className="btn btn-soft btn-block" onClick={() => askAgent("I want to set a new goal")}>
              <I.Plus size={18} /> New goal
            </button>
          </div>
        )}
    </TabScreen>
  );
}
