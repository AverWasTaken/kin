import { motion } from "motion/react";
import { useKin, type Tab } from "../lib/store";
import { setTab } from "../lib/actions";
import { I } from "./Icons";

const TABS: { id: Tab; label: string; icon: keyof typeof I; on: keyof typeof I }[] = [
  { id: "chat", label: "Chat", icon: "Chat", on: "ChatFill" },
  { id: "today", label: "Today", icon: "Sun", on: "SunFill" },
  { id: "goals", label: "Goals", icon: "Target", on: "TargetFill" },
  { id: "library", label: "Library", icon: "Books", on: "BooksFill" },
];

/** A floating glass capsule. It steps aside while you type and settles back once you send. */
export function TabBar() {
  const tab = useKin((s) => s.tab);
  const unread = useKin((s) => s.threads.reduce((n, t) => n + (s.tab === "chat" && t.id === s.activeThreadId ? 0 : t.unread), 0));
  const approvals = useKin((s) => s.pendingApprovals.length);
  const away = useKin((s) => s.keyboardOpen || (s.tab === "chat" && s.composing));
  const badge = unread + (tab === "chat" ? 0 : approvals);

  return (
    <nav className={`tabbar ${away ? "away" : ""}`} aria-label="Sections" aria-hidden={away || undefined} inert={away || undefined}>
      {TABS.map((t) => {
        const on = tab === t.id;
        const Icon = I[on ? t.on : t.icon];
        return (
          <button key={t.id} type="button" className={`tab ${on ? "on" : ""}`} aria-current={on ? "page" : undefined} onClick={() => setTab(t.id)}>
            {on && <motion.span className="tab-lens" layoutId="tab-lens" transition={{ type: "spring", stiffness: 380, damping: 30 }} />}
            <motion.span className="tab-icon" whileTap={{ scale: 0.86 }} transition={{ type: "spring", stiffness: 460, damping: 20 }}>
              <Icon size={24} />
              {t.id === "chat" && badge > 0 && (
                <motion.span className="tab-badge" key={badge} initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 600, damping: 16 }}>
                  {badge > 99 ? "99+" : badge}
                </motion.span>
              )}
            </motion.span>
            <span className="tab-label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
