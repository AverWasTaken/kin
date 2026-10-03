import { useState } from "react";
import { setKin, useKin, type Tab } from "../lib/store";
import { newThread, openThread, setTab } from "../lib/actions";
import { Avatar } from "./Avatar";
import { I } from "./Icons";
import { when } from "./chat/ThreadDrawer";

const SECTIONS: { id: Exclude<Tab, "chat">; label: string; icon: keyof typeof I }[] = [
  { id: "today", label: "Today", icon: "Sun" },
  { id: "goals", label: "Goals", icon: "Target" },
  { id: "library", label: "Library", icon: "Books" },
];

const BUSY = new Set(["reading", "thinking", "typing", "working"]);

/** Messages-for-Mac sidebar: search, conversations, then Kin's other sections. */
export function Sidebar() {
  const threads = useKin((s) => s.threads);
  const active = useKin((s) => s.activeThreadId);
  const tab = useKin((s) => s.tab);
  const agent = useKin((s) => s.agent);
  const states = useKin((s) => s.agentState);
  const [q, setQ] = useState("");

  const needle = q.trim().toLowerCase();
  const sorted = [...threads]
    .sort((a, b) => (a.main === b.main ? b.lastMessageAt - a.lastMessageAt : a.main ? -1 : 1))
    .filter((t) => !needle || `${t.main ? agent.name : t.title} ${t.preview}`.toLowerCase().includes(needle));

  return (
    <aside className="sidebar" aria-label="Chats">
      <div className="sb-top">
        <span className="sb-title">Chats</span>
        <button type="button" className="sb-icon" aria-label="New chat" title="New chat" onClick={() => newThread()}>
          <I.Compose size={19} />
        </button>
      </div>
      <label className="sb-search">
        <I.Search size={14} />
        <input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" />
      </label>

      <div className="sb-list scroll">
        {sorted.map((t) => {
          const st = states[t.id]?.state;
          const on = tab === "chat" && t.id === active;
          return (
            <button key={t.id} type="button" className={`sb-thread ${on ? "on" : ""}`} aria-current={on || undefined} onClick={() => openThread(t.id)}>
              <span className={`sb-unread ${t.unread > 0 && !on ? "show" : ""}`} aria-label={t.unread > 0 ? `${t.unread} unread` : undefined} />
              <span className="sb-avatar">
                {t.main ? <Avatar config={agent.avatar} size={40} state={st ?? "idle"} /> : <I.Chat size={18} />}
              </span>
              <span className="sb-text">
                <span className="sb-line">
                  <span className="sb-name ellipsis">{t.main ? agent.name : t.title}</span>
                  <span className="sb-time">{when(t.lastMessageAt)}</span>
                </span>
                <span className="sb-preview">{st && BUSY.has(st) ? <em>{states[t.id]?.status || "working…"}</em> : t.preview || "No messages yet"}</span>
              </span>
            </button>
          );
        })}
        {sorted.length === 0 && <div className="sb-empty">No chats match "{q.trim()}"</div>}
      </div>

      <nav className="sb-sections" aria-label="Sections">
        {SECTIONS.map((s) => {
          const Icon = I[s.icon];
          return (
            <button key={s.id} type="button" className={`sb-section ${tab === s.id ? "on" : ""}`} aria-current={tab === s.id ? "page" : undefined} onClick={() => setTab(s.id)}>
              <Icon size={18} />
              <span>{s.label}</span>
            </button>
          );
        })}
        <button type="button" className="sb-section sb-profile" onClick={() => setKin({ profileOpen: true })}>
          <Avatar config={agent.avatar} size={20} state="idle" />
          <span>{agent.name}'s settings</span>
        </button>
      </nav>
    </aside>
  );
}
