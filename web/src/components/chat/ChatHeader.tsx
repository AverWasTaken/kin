import { AnimatePresence, motion } from "motion/react";
import type { AgentState } from "@shared/api";
import { useKin } from "../../lib/store";
import { Avatar } from "../Avatar";
import { I } from "../Icons";

interface Props {
  state: AgentState;
  status: string;
  title: string;
  isMain: boolean;
  onMenu: () => void;
  onProfile: () => void;
  onNew: () => void;
}

export function statusText(state: AgentState, status: string, online: boolean) {
  if (!online) return "connecting…";
  if (state === "idle" || state === "listening" || state === "done") return state === "done" ? "done" : "active now";
  if (state === "asleep") return "resting";
  return status || `${state}…`;
}

export function ChatHeader({ state, status, title, isMain, onMenu, onProfile, onNew }: Props) {
  const agent = useKin((s) => s.agent);
  const online = useKin((s) => s.streamStatus === "open");
  const unreadElsewhere = useKin((s) => s.threads.some((t) => t.id !== s.activeThreadId && t.unread > 0));
  const line = statusText(state, status, online);
  const busy = online && line !== "active now" && line !== "resting" && line !== "done";

  return (
    <header className="chat-head">
      <button type="button" className="icon-btn head-left" aria-label="Chats" onClick={onMenu}>
        <I.Menu size={24} />
        {unreadElsewhere && <span className="head-dot" />}
      </button>

      <button type="button" className="head-center" onClick={onProfile} aria-label={`${agent.name} profile`}>
        <span className="head-avatar">
          <Avatar config={agent.avatar} state={state} size={44} title={agent.name} />
        </span>
        <span className="head-name">
          {isMain ? agent.name : title}
          <I.ChevronRight size={11} />
        </span>
        <span className="head-status" aria-live="polite">
          {/* Old and new lines overlap in one grid cell: a pure opacity/transform crossfade. */}
          <AnimatePresence initial={false}>
            <motion.span
              key={line}
              className={busy ? "busy" : online ? "on" : ""}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
            >
              {line === "active now" && <i className="live-dot" />}
              {line}
            </motion.span>
          </AnimatePresence>
        </span>
      </button>

      <button type="button" className="icon-btn head-right" aria-label="New chat" onClick={onNew}>
        <I.Compose size={22} />
      </button>
    </header>
  );
}
