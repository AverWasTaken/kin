import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AgentState, AvatarConfig } from "@shared/api";
import { finishOnboarding } from "../lib/actions";
import { applyAccent } from "../lib/color";
import { toast, useKin } from "../lib/store";
import { enablePush, pushState, type PushState } from "../lib/push";
import { Avatar } from "../components/Avatar";
import { AvatarCustomizer } from "../components/AvatarCustomizer";
import { I } from "../components/Icons";

const SUGGESTED = ["Pip", "Juno", "Moss", "Biscuit", "Ollie", "Wren"];
const STEPS = 5;

const CONN = {
  connected: { label: "Connected", cls: "ok" },
  needs_auth: { label: "Needs sign-in", cls: "warn" },
  error: { label: "Error", cls: "err" },
  unknown: { label: "Not set up", cls: "" },
} as const;

export function Onboarding() {
  const initial = useKin((s) => s.agent);
  const connections = useKin((s) => s.connections);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [name, setName] = useState(initial.name === "Kin" ? "" : initial.name);
  const [avatar, setAvatar] = useState<AvatarConfig>(initial.avatar);
  const [about, setAbout] = useState({ name: "", location: "", work: "", interests: "", notes: "" });
  const [mood, setMood] = useState<AgentState>("idle");
  const [push, setPush] = useState<PushState>(() => pushState());
  const [busy, setBusy] = useState(false);
  const moodTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const agentName = name.trim() || "your agent";

  useEffect(() => applyAccent(avatar.color), [avatar.color]);

  const react = (s: AgentState, ms = 900) => {
    clearTimeout(moodTimer.current);
    setMood(s);
    moodTimer.current = setTimeout(() => setMood("idle"), ms);
  };

  useEffect(() => {
    if (step === 3) setMood("reading");
    else setMood("idle");
  }, [step]);

  const canNext = step === 0 ? name.trim().length > 0 : step === 2 ? about.name.trim().length > 0 : true;

  const go = (d: number) => {
    setDir(d);
    setStep((s) => Math.max(0, Math.min(STEPS - 1, s + d)));
    if (d > 0) react("done", 800);
  };

  const finish = async () => {
    setBusy(true);
    setMood("working");
    try {
      await finishOnboarding({
        agentName: name.trim(),
        avatar,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        about: {
          name: about.name.trim(),
          location: about.location.trim() || undefined,
          work: about.work.trim() || undefined,
          interests: about.interests.trim() || undefined,
          notes: about.notes.trim() || undefined,
        },
      });
    } catch (e) {
      setBusy(false);
      setMood("idle");
      toast(e instanceof Error ? `Couldn't finish setup: ${e.message}` : "Couldn't finish setup");
    }
  };

  const titles = [
    { t: "Name your agent", s: "Pick something you'd like to text every day. You can change it later." },
    { t: `Give ${agentName} a look`, s: "This little face shows what it's up to: reading, thinking, typing." },
    { t: `Tell ${agentName} about you`, s: "A few basics so it doesn't have to ask. Only your name is required." },
    { t: "Connect your accounts", s: `${agentName} can check these when you ask, and only acts with your OK.` },
    { t: "Stay in the loop", s: `Get a notification when ${agentName} replies, needs your OK, or finishes something.` },
  ];

  const field = (key: keyof typeof about, label: string, placeholder: string, multiline = false) => (
    <label className="field-label">
      {label}
      {multiline ? (
        <textarea
          className="field"
          rows={3}
          value={about[key]}
          placeholder={placeholder}
          onChange={(e) => {
            setAbout({ ...about, [key]: e.target.value });
            react("listening", 1200);
          }}
        />
      ) : (
        <input
          className="field"
          value={about[key]}
          placeholder={placeholder}
          autoComplete={key === "name" ? "given-name" : key === "location" ? "address-level2" : "off"}
          onChange={(e) => {
            setAbout({ ...about, [key]: e.target.value });
            react("listening", 1200);
          }}
        />
      )}
    </label>
  );

  return (
    <div className="screen onboarding">
      <div className="ob-top">
        <button type="button" className={`icon-btn ${step === 0 ? "hidden" : ""}`} aria-label="Back" onClick={() => go(-1)} disabled={step === 0}>
          <I.ChevronLeft size={24} />
        </button>
        <div className="ob-dots" aria-label={`Step ${step + 1} of ${STEPS}`}>
          {Array.from({ length: STEPS }, (_, i) => (
            <motion.span key={i} className={i <= step ? "on" : ""} animate={{ width: i === step ? 22 : 7 }} transition={{ type: "spring", stiffness: 500, damping: 34 }} />
          ))}
        </div>
        <span className="ob-spacer" />
      </div>

      <div className="ob-scroll scroll">
        <div className="ob-avatar-wrap">
          <motion.div
            className="ob-avatar"
            animate={{ scale: step === 1 ? 0.78 : 1, marginBottom: step === 1 ? -30 : 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
          >
            <Avatar config={avatar} state={mood} size={136} ground />
          </motion.div>
        </div>

        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={step}
            className="ob-step"
            custom={dir}
            initial={{ opacity: 0, x: dir * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -40 }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
          >
            <h1 className="ob-title">{titles[step].t}</h1>
            <p className="ob-sub">{titles[step].s}</p>

            {step === 0 && (
              <div className="ob-body">
                <input
                  className="field ob-name"
                  value={name}
                  maxLength={24}
                  placeholder="Name"
                  aria-label="Agent name"
                  autoFocus
                  onChange={(e) => {
                    setName(e.target.value);
                    react("listening", 1100);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && canNext && go(1)}
                />
                <div className="ob-suggest">
                  {SUGGESTED.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`chip ${name === n ? "chip-on" : ""}`}
                      onClick={() => {
                        setName(n);
                        react("done", 800);
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="ob-body">
                <AvatarCustomizer
                  value={avatar}
                  onChange={(v) => {
                    setAvatar(v);
                    react("done", 800);
                  }}
                />
              </div>
            )}

            {step === 2 && (
              <div className="ob-body ob-form">
                {field("name", "Your name", "What should it call you?")}
                {field("location", "Where you live", "City or neighborhood")}
                {field("work", "What you do", "Job, school, or whatever fills your days")}
                {field("interests", "Things you're into", "Running, baking, sci-fi…")}
                {field("notes", "Anything else", "Allergies, people who matter, pet peeves…", true)}
              </div>
            )}

            {step === 3 && (
              <div className="ob-body">
                <div className="group-body">
                  {connections.map((c) => {
                    const st = CONN[c.status];
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
                  {connections.length === 0 && <div className="row muted">No connections reported yet.</div>}
                </div>
                <div className="ob-note">
                  <I.Link size={18} />
                  <p>
                    Gmail, Google Calendar and Drive connect through claude.ai. Open <b>claude.ai › Settings › Connectors</b>, connect them there, and they show up here.
                  </p>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="ob-body">
                <div className="ob-push">
                  {push === "granted" ? (
                    <div className="ob-push-on">
                      <span className="ob-push-check">
                        <I.Check size={20} />
                      </span>
                      Notifications are on
                    </div>
                  ) : push === "needs-install" ? (
                    <div className="ob-note">
                      <I.Bell size={18} />
                      <p>
                        On iPhone, notifications work once Kin is on your Home Screen. Tap <b>Share</b>, then <b>Add to Home Screen</b>. You can turn them on later from {agentName}'s profile.
                      </p>
                    </div>
                  ) : push === "denied" ? (
                    <div className="ob-note">
                      <I.Bell size={18} />
                      <p>Notifications are blocked for this site. You can allow them in your browser settings.</p>
                    </div>
                  ) : push === "unsupported" ? (
                    <div className="ob-note">
                      <I.Bell size={18} />
                      <p>This browser can't receive push notifications.</p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-soft btn-block"
                      onClick={async () => {
                        const r = await enablePush();
                        setPush(r);
                        if (r === "granted") react("done", 900);
                      }}
                    >
                      <I.Bell size={18} /> Enable notifications
                    </button>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="ob-foot">
        {step < STEPS - 1 ? (
          <button type="button" className="btn btn-ink btn-block" disabled={!canNext} onClick={() => go(1)}>
            Continue
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={finish}>
            {busy ? "Waking up…" : `Meet ${agentName}`}
          </button>
        )}
      </div>
    </div>
  );
}
