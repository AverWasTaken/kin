import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useKin } from "../../lib/store";
import { newThread, openThread } from "../../lib/actions";
import { clock, separator } from "../../lib/time";
import { Avatar } from "../Avatar";
import { I } from "../Icons";

export function when(ts: number) {
  const s = separator(ts);
  return s.day === "Today" ? clock(ts) : s.day;
}

export function ThreadDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const threads = useKin((s) => s.threads);
  const active = useKin((s) => s.activeThreadId);
  const agent = useKin((s) => s.agent);
  const states = useKin((s) => s.agentState);
  const root = document.getElementById("overlay-root");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const sorted = [...threads].sort((a, b) => (a.main === b.main ? b.lastMessageAt - a.lastMessageAt : a.main ? -1 : 1));

  const content = (
    <AnimatePresence>
      {open && (
        <div className="drawer-layer" key="drawer">
          <motion.div className="drawer-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.nav
            className="drawer"
            aria-label="Chats"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 36 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.8, right: 0 }}
            onDragEnd={(_, i) => (i.offset.x < -80 || i.velocity.x < -500) && onClose()}
          >
            <div className="drawer-head">
              <h2>Chats</h2>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  onClose();
                  await newThread();
                }}
              >
                <I.Plus size={16} /> New chat
              </button>
            </div>
            <div className="drawer-list scroll">
              {sorted.map((t) => {
                const st = states[t.id]?.state;
                const working = st === "thinking" || st === "typing" || st === "working" || st === "reading";
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`thread-item ${t.id === active ? "active" : ""}`}
                    onClick={() => {
                      onClose();
                      openThread(t.id);
                    }}
                  >
                    <span className="thread-icon">
                      {t.main ? <Avatar config={agent.avatar} size={40} state={st ?? "idle"} /> : <I.Chat size={20} />}
                    </span>
                    <span className="thread-text">
                      <span className="thread-line">
                        <span className="thread-title ellipsis">{t.main ? agent.name : t.title}</span>
                        <span className="thread-time">{when(t.lastMessageAt)}</span>
                      </span>
                      <span className="thread-preview">
                        {working ? <em>{states[t.id]?.status || "working…"}</em> : t.preview || "No messages yet"}
                      </span>
                    </span>
                    {t.unread > 0 && <span className="unread-dot" aria-label={`${t.unread} unread`} />}
                  </button>
                );
              })}
            </div>
          </motion.nav>
        </div>
      )}
    </AnimatePresence>
  );
  return root ? createPortal(content, root) : content;
}
