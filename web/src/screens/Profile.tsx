import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AgentInfo, Proactivity, Run, Schedule, Settings } from "@shared/api";
import { api } from "../lib/client";
import { applyAccent } from "../lib/color";
import { getKin, setKin, toast, useKin } from "../lib/store";
import { useResource } from "../lib/useResource";
import { compactNumber, relative, upcoming, clock } from "../lib/time";
import { enablePush, pushState, type PushState } from "../lib/push";
import type { MemoryName } from "../lib/api";
import { Avatar } from "../components/Avatar";
import { AvatarCustomizer } from "../components/AvatarCustomizer";
import { Segmented, Switch } from "../components/Controls";
import { I, type IconName } from "../components/Icons";
import { Sheet } from "../components/Sheet";
import { MemoryEditor } from "./MemoryEditor";

export const RUN_STATUS: Record<Run["status"], { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "" },
  running: { label: "Running", cls: "info" },
  waiting: { label: "Waiting", cls: "warn" },
  ok: { label: "Done", cls: "ok" },
  error: { label: "Failed", cls: "err" },
  aborted: { label: "Stopped", cls: "" },
  timeout: { label: "Timed out", cls: "err" },
};

const SCHEDULE_ICON: Record<Schedule["kind"], { icon: IconName; color: string }> = {
  reminder: { icon: "Bell", color: "#D9A21B" },
  task: { icon: "Bolt", color: "#3D84D6" },
  builtin: { icon: "Sun", color: "#E07A3D" },
};

/* --------------------------------------------------------------- Hero */

function Hero() {
  const agent = useKin((s) => s.agent);
  const state = useKin((s) => s.agentState[s.threads.find((t) => t.main)?.id ?? ""]?.state ?? "idle");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AgentInfo>(agent);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(agent);
  }, [agent, editing]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.patchAgent({ name: draft.name.trim() || agent.name, tagline: draft.tagline, avatar: draft.avatar });
      setKin({ agent: next });
      applyAccent(next.avatar.color);
      setEditing(false);
    } catch {
      toast("Couldn't save changes");
    } finally {
      setSaving(false);
    }
  };

  const shown = editing ? draft : agent;
  return (
    <div className="hero">
      <motion.div className="hero-avatar" layout>
        <Avatar config={shown.avatar} state={editing ? "listening" : state} size={140} ground />
      </motion.div>
      <AnimatePresence mode="wait" initial={false}>
        {editing ? (
          <motion.div key="edit" className="hero-edit" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <label className="field-label">
              Name
              <input className="field" value={draft.name} maxLength={24} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="field-label">
              Tagline
              <input
                className="field"
                value={draft.tagline}
                maxLength={60}
                placeholder="A few words about them"
                onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
              />
            </label>
            <AvatarCustomizer value={draft.avatar} onChange={(avatar) => setDraft({ ...draft, avatar })} />
            <div className="hero-edit-actions">
              <button type="button" className="btn btn-soft" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="view" className="hero-view" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <h1 className="hero-name">{agent.name}</h1>
            <p className="hero-tagline">{agent.tagline || "No tagline yet"}</p>
            <button type="button" className="btn btn-soft btn-sm" onClick={() => setEditing(true)}>
              Edit look and name
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------- Schedules */

const UPCOMING_PREVIEW = 5;

function Upcoming() {
  const version = useKin((s) => s.versions.schedules);
  const { data, setData } = useResource(() => api.schedules(), version);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"scheduled" | "archive">("scheduled");
  const [showAll, setShowAll] = useState(false);

  const toggle = async (s: Schedule, enabled: boolean) => {
    setData((d) => d?.map((x) => (x.id === s.id ? { ...x, enabled } : x)) ?? d);
    try {
      await api.patchSchedule(s.id, { enabled });
    } catch {
      setData((d) => d?.map((x) => (x.id === s.id ? s : x)) ?? d);
      toast("Couldn't update the schedule");
    }
  };
  const remove = async (s: Schedule) => {
    setData((d) => d?.filter((x) => x.id !== s.id) ?? d);
    try {
      await api.deleteSchedule(s.id);
      toast(`Deleted "${s.title}"`);
    } catch {
      toast("Couldn't delete");
    }
  };
  const runNow = async (s: Schedule) => {
    try {
      await api.runSchedule(s.id);
      toast(`Running "${s.title}" now`);
    } catch {
      toast("Couldn't start it");
    }
  };

  // Finished one-shot reminders and anything switched off live in the archive.
  const scheduled = (data ?? []).filter((s) => s.enabled).sort((a, b) => (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity));
  const archived = (data ?? []).filter((s) => !s.enabled).sort((a, b) => (b.lastAt ?? b.at ?? 0) - (a.lastAt ?? a.at ?? 0));
  const all = tab === "scheduled" ? scheduled : archived;
  const list = showAll ? all : all.slice(0, UPCOMING_PREVIEW);
  const hidden = all.length - list.length;

  return (
    <section className="group">
      <div className="group-title">Upcoming</div>
      <div className="group-seg">
        <Segmented
          label="Upcoming"
          value={tab}
          onChange={(v) => {
            setTab(v);
            setShowAll(false);
            setOpen(null);
          }}
          options={[
            { value: "scheduled", label: "Scheduled" },
            { value: "archive", label: archived.length ? `Archive (${archived.length})` : "Archive" },
          ]}
        />
      </div>
      <div className="group-body">
        {!data && <div className="row muted">Loading…</div>}
        {data && all.length === 0 && (
          <div className="row muted">{tab === "scheduled" ? "Nothing scheduled. Ask for a reminder in chat." : "Nothing archived yet."}</div>
        )}
        {list.map((s) => {
          const ic = SCHEDULE_ICON[s.kind];
          const Icon = I[ic.icon];
          const expanded = open === s.id;
          return (
            <div key={s.id} className={`sched ${expanded ? "open" : ""}`}>
              <div className="row has-icon" onClick={() => setOpen(expanded ? null : s.id)} role="button" tabIndex={0} aria-expanded={expanded}>
                <span className="row-icon" style={{ background: s.enabled ? ic.color : "var(--text-3)" }}>
                  <Icon size={17} />
                </span>
                <span className="row-main">
                  <span className={`row-title sched-title ${s.enabled ? "" : "muted"}`}>{s.title}</span>
                  <span className="row-sub">
                    {s.human}
                    {s.enabled && s.nextAt ? ` · next ${upcoming(s.nextAt)}` : ""}
                    {!s.enabled && s.lastAt ? ` · ran ${relative(s.lastAt)}` : ""}
                  </span>
                </span>
                <Switch checked={s.enabled} onChange={(v) => toggle(s, v)} label={`${s.title} enabled`} />
              </div>
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div className="sched-actions" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                    <div className="sched-actions-inner">
                      <button type="button" className="chip" onClick={() => runNow(s)}>
                        <I.Play size={13} /> Run now
                      </button>
                      {s.kind !== "builtin" && (
                        <button type="button" className="chip chip-danger" onClick={() => remove(s)}>
                          <I.Trash size={14} /> Delete
                        </button>
                      )}
                      {s.lastAt && <span className="sched-last">Last ran {relative(s.lastAt)}</span>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
        {hidden > 0 && (
          <button type="button" className="row sched-more" onClick={() => setShowAll(true)}>
            Show {hidden} more
          </button>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ Activity */

export function RunRow({ run }: { run: Run }) {
  const st = RUN_STATUS[run.status];
  return (
    <button type="button" className="row run-row" onClick={() => setKin({ runDetail: run.id })}>
      <span className="row-main">
        <span className="row-title ellipsis">{run.title}</span>
        <span className="row-sub">
          {run.kind} · {relative(run.startedAt ?? run.createdAt)}
          {run.tokens ? ` · ${compactNumber(run.tokens)} tokens` : ""}
        </span>
      </span>
      <span className={`pill ${st.cls}`}>
        {(run.status === "running" || run.status === "waiting") && <span className="dot" />}
        {st.label}
      </span>
      <I.ChevronRight size={15} className="chev" />
    </button>
  );
}

function Activity() {
  const [tab, setTab] = useState<"active" | "done">("active");
  const version = useKin((s) => s.versions.runs);
  const { data } = useResource(() => api.runs(tab, 20), `${tab}-${version}`);
  return (
    <section className="group">
      <div className="group-title">Activity</div>
      <div className="group-seg">
        <Segmented
          label="Activity"
          value={tab}
          onChange={setTab}
          options={[
            { value: "active", label: "In progress" },
            { value: "done", label: "Completed" },
          ]}
        />
      </div>
      <div className="group-body">
        {data?.map((r) => <RunRow key={r.id} run={r} />)}
        {data && data.length === 0 && <div className="row muted">{tab === "active" ? "Nothing running right now." : "No finished runs yet."}</div>}
        {!data && <div className="row muted">Loading…</div>}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- Memory */

const MEMORY_ROWS: { name: MemoryName; title: string; sub: string; icon: IconName; color: string }[] = [
  { name: "soul", title: "Soul", sub: "Personality and ground rules", icon: "Sparkle", color: "#8B6FD6" },
  { name: "identity", title: "About you", sub: "Who you are, what you like", icon: "People", color: "#E3739D" },
  { name: "memory", title: "Memory", sub: "Things it has learned over time", icon: "Brain", color: "#3D84D6" },
];

function Memory({ onOpen }: { onOpen: (n: MemoryName) => void }) {
  return (
    <section className="group">
      <div className="group-title">Memory</div>
      <div className="group-body">
        {MEMORY_ROWS.map((m) => {
          const Icon = I[m.icon];
          return (
            <button key={m.name} type="button" className="row has-icon" onClick={() => onOpen(m.name)}>
              <span className="row-icon" style={{ background: m.color }}>
                <Icon size={17} />
              </span>
              <span className="row-main">
                <span className="row-title">{m.title}</span>
                <span className="row-sub">{m.sub}</span>
              </span>
              <I.ChevronRight size={15} className="chev" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* --------------------------------------------------------- Connections */

const CONN_STATUS = {
  connected: { label: "Connected", cls: "ok" },
  needs_auth: { label: "Needs sign-in", cls: "warn" },
  error: { label: "Error", cls: "err" },
  unknown: { label: "Unknown", cls: "" },
} as const;

export function Connections() {
  const connections = useKin((s) => s.connections);
  return (
    <section className="group">
      <div className="group-title">Connections</div>
      <div className="group-body">
        {connections.map((c) => {
          const st = CONN_STATUS[c.status];
          return (
            <div key={c.id} className="row">
              <span className="row-main">
                <span className="row-title">{c.name}</span>
                {c.detail && <span className="row-sub ellipsis">{c.detail}</span>}
              </span>
              <span className={`pill ${st.cls}`}>
                <span className="dot" />
                {st.label}
              </span>
            </div>
          );
        })}
        {connections.length === 0 && <div className="row muted">No connections reported by the server.</div>}
      </div>
      <p className="group-foot">Gmail, Calendar and Drive are connected at claude.ai, under Settings › Connectors.</p>
    </section>
  );
}

/* ------------------------------------------------------------ Settings */

function SettingsSection() {
  const settings = useKin((s) => s.settings);
  const agentName = useKin((s) => s.agent.name);
  const [push, setPush] = useState<PushState>(() => pushState());

  if (!settings) return null;

  const patch = async (p: Partial<Settings>) => {
    const prev = getKin().settings;
    setKin({ settings: { ...settings, ...p } });
    try {
      setKin({ settings: await api.patchSettings(p) });
    } catch {
      setKin({ settings: prev });
      toast("Couldn't save settings");
    }
  };

  return (
    <section className="group">
      <div className="group-title">Settings</div>
      <div className="group-body">
        <div className="row stack">
          <span className="row-main">
            <span className="row-title">Check-ins</span>
            <span className="row-sub">How often it reaches out on its own</span>
          </span>
          <Segmented<Proactivity>
            label="Proactivity"
            value={settings.proactivity}
            onChange={(v) => patch({ proactivity: v })}
            options={[
              { value: "off", label: "Off" },
              { value: "less", label: "Less" },
              { value: "more", label: "More" },
            ]}
          />
        </div>
        <div className="row">
          <span className="row-main">
            <span className="row-title">Morning brief</span>
          </span>
          <input className="time-input" type="time" value={settings.briefTime} onChange={(e) => patch({ briefTime: e.target.value })} aria-label="Morning brief time" />
        </div>
        <div className="row">
          <span className="row-main">
            <span className="row-title">Quiet hours</span>
            <span className="row-sub">No notifications, no check-ins</span>
          </span>
          <Switch
            checked={!!settings.quietHours}
            onChange={(v) => patch({ quietHours: v ? { start: "22:00", end: "07:00" } : null })}
            label="Quiet hours"
          />
        </div>
        {settings.quietHours && (
          <div className="row qh-row">
            <span className="row-sub qh-label">From</span>
            <input className="time-input" type="time" value={settings.quietHours.start} onChange={(e) => patch({ quietHours: { ...settings.quietHours!, start: e.target.value } })} aria-label="Quiet hours start" />
            <span className="row-sub">to</span>
            <input className="time-input" type="time" value={settings.quietHours.end} onChange={(e) => patch({ quietHours: { ...settings.quietHours!, end: e.target.value } })} aria-label="Quiet hours end" />
          </div>
        )}
        <div className="row tz-row">
          <span className="row-main row-title">Time zone</span>
          <span className="row-value">{settings.timezone.replace(/_/g, " ")}</span>
        </div>
      </div>

      <div className="group-title sub">Permissions</div>
      <div className="group-body">
        <div className="row">
          <span className="row-main">
            <span className="row-title">Ask before acting</span>
            <span className="row-sub">
              {settings.askBeforeActing
                ? "Sending, deleting and controlling things waits for your OK"
                : `${agentName} goes ahead without asking`}
            </span>
          </span>
          <Switch checked={settings.askBeforeActing} onChange={(v) => patch({ askBeforeActing: v })} label="Ask before acting" />
        </div>
      </div>

      <div className="group-title sub">Notifications</div>
      <div className="group-body">
        {(
          [
            ["messages", "Messages"],
            ["approvals", "Permission requests"],
            ["tasks", "Finished tasks"],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="row">
            <span className="row-main row-title">{label}</span>
            <Switch checked={settings.notifications[k]} onChange={(v) => patch({ notifications: { ...settings.notifications, [k]: v } })} label={label} />
          </div>
        ))}
        <div className="row push-row">
          {push === "granted" ? (
            <>
              <span className="row-main">
                <span className="row-title">Notifications are on</span>
                <span className="row-sub">This device gets push notifications.</span>
              </span>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => api.pushTest().then(() => toast("Test sent"))}>
                Send test
              </button>
            </>
          ) : push === "needs-install" ? (
            <span className="row-main">
              <span className="row-title">Add to Home Screen first</span>
              <span className="row-sub">
                On iPhone, notifications work once Kin is installed: tap Share, then <b>Add to Home Screen</b>, and open it from there.
              </span>
            </span>
          ) : push === "denied" ? (
            <span className="row-main">
              <span className="row-title">Notifications are blocked</span>
              <span className="row-sub">Turn them on in Settings › Notifications › Kin.</span>
            </span>
          ) : push === "unsupported" ? (
            <span className="row-main">
              <span className="row-title">This browser can't do push notifications</span>
            </span>
          ) : (
            <button type="button" className="btn btn-primary btn-block" onClick={async () => setPush(await enablePush())}>
              <I.Bell size={18} /> Enable notifications
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- Usage */

function UsageSection() {
  const live = useKin((s) => s.usage);
  const { data } = useResource(() => api.usage());
  const u = live ?? data;
  if (!u) return null;
  const rl = u.rateLimit;
  const pct = rl ? Math.round(rl.utilization * 100) : 0;
  const maxKind = Math.max(1, ...u.byKind.map((k) => k.tokens));
  return (
    <section className="group">
      <div className="group-title">Usage</div>
      {u.pausedUntil && u.pausedUntil > Date.now() && (
        <div className="paused-banner">
          <I.Pause size={14} /> Paused until {clock(u.pausedUntil)}. Background work resumes after that.
        </div>
      )}
      <div className="group-body usage">
        <div className="usage-stats">
          <div>
            <span className="stat-num">{u.today.runs}</span>
            <span className="stat-label">runs today</span>
            <span className="stat-sub">{compactNumber(u.today.tokens)} tokens</span>
          </div>
          <div>
            <span className="stat-num">{u.week.runs}</span>
            <span className="stat-label">this week</span>
            <span className="stat-sub">{compactNumber(u.week.tokens)} tokens</span>
          </div>
        </div>
        {rl && (
          <div className="ratelimit">
            <div className="ratelimit-line">
              <span>{rl.window} limit</span>
              <span>
                {pct}% · resets {relative(rl.resetsAt)}
              </span>
            </div>
            <div className={`meter ${pct > 85 ? "hot" : pct > 60 ? "warm" : ""}`}>
              <motion.span initial={{ scaleX: 0 }} animate={{ scaleX: rl.utilization }} transition={{ type: "spring", stiffness: 80, damping: 20 }} />
            </div>
          </div>
        )}
        <div className="by-kind">
          {u.byKind.map((k) => (
            <div key={k.kind} className="by-kind-row">
              <span className="by-kind-name">{k.kind}</span>
              <span className="by-kind-bar">
                <span style={{ width: `${(k.tokens / maxKind) * 100}%` }} />
              </span>
              <span className="by-kind-val">{compactNumber(k.tokens)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- Sheet */

export function ProfileSheet() {
  const open = useKin((s) => s.profileOpen);
  const online = useKin((s) => s.streamStatus);
  const [memory, setMemory] = useState<MemoryName | null>(null);

  return (
    <Sheet
      open={open}
      onClose={() => setKin({ profileOpen: false })}
      label="Profile"
      right={
        <button type="button" className="btn btn-plain" onClick={() => setKin({ profileOpen: false })}>
          Done
        </button>
      }
      className="profile-sheet"
    >
      <Hero />
      <Upcoming />
      <Activity />
      <Memory onOpen={setMemory} />
      <Connections />
      <SettingsSection />
      <UsageSection />
      <p className="profile-foot">
        Kin · {online === "open" ? "connected" : online === "connecting" ? "connecting…" : "offline, retrying"}
      </p>
      <MemoryEditor name={memory} onClose={() => setMemory(null)} />
    </Sheet>
  );
}
