import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AgentState, Message } from "@shared/api";
import { isBusy, setKin, useKin } from "../lib/store";
import { newThread } from "../lib/actions";
import { ChatHeader } from "../components/chat/ChatHeader";
import { MessageList } from "../components/chat/MessageList";
import { Composer } from "../components/chat/Composer";
import { ReactionMenu, type MenuTarget } from "../components/chat/ReactionMenu";
import { ThreadDrawer } from "../components/chat/ThreadDrawer";
import { Avatar } from "../components/Avatar";
import { I } from "../components/Icons";
import { useWide } from "../lib/viewport";

function ApprovalBanner() {
  const pending = useKin((s) => s.pendingApprovals);
  const agent = useKin((s) => s.agent);
  const latest = pending[pending.length - 1];
  return (
    <AnimatePresence>
      {latest?.approval && (
        <motion.button
          type="button"
          className="ap-banner"
          initial={{ opacity: 0, y: -12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 360, damping: 30 }}
          onClick={() => {
            const el = document.getElementById(`ap-${latest.approval!.approvalId}`);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
            else if (latest.threadId !== useKin.getState().activeThreadId) setKin({ activeThreadId: latest.threadId });
          }}
        >
          <span className="ap-banner-icon">
            <I.Shield size={16} />
          </span>
          <span className="ap-banner-text">
            <b>{agent.name} needs your OK</b>
            <span className="ellipsis">{latest.approval.title}</span>
          </span>
          {pending.length > 1 && <span className="ap-banner-count">{pending.length}</span>}
          <I.ChevronDown size={16} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function EmptyThread({ name }: { name: string }) {
  const agent = useKin((s) => s.agent);
  return (
    <div className="thread-empty">
      <Avatar config={agent.avatar} size={96} state="idle" ground />
      <p>
        Say hi to <b>{name}</b>. Ask for anything: a reminder, a plan for Saturday, a second look at an email.
      </p>
    </div>
  );
}

export function Chat() {
  const threadId = useKin((s) => s.activeThreadId);
  const thread = useKin((s) => s.threads.find((t) => t.id === s.activeThreadId));
  const ts = useKin((s) => s.agentState[s.activeThreadId]);
  const userTyping = useKin((s) => s.userTyping);
  const count = useKin((s) => s.messages[s.activeThreadId]?.length ?? -1);
  const agentName = useKin((s) => s.agent.name);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [reply, setReply] = useState<Message | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [bottomSignal, setBottomSignal] = useState(0);

  useEffect(() => {
    setReply(null);
    setMenu(null);
  }, [threadId]);

  const raw = ts?.state ?? "idle";
  // The avatar perks up while you type, even before the server echoes "listening".
  const state: AgentState = userTyping && (raw === "idle" || raw === "done") ? "listening" : raw;

  const onMenu = useCallback((m: Message, el: HTMLElement) => {
    const list = useKin.getState().messages[m.threadId] ?? [];
    const quote = m.replyTo ? list.find((x) => x.id === m.replyTo) : null;
    setMenu({ m, rect: el.getBoundingClientRect(), quote });
  }, []);
  const onReply = useCallback((m: Message) => setReply(m), []);
  const onOpenRun = useCallback((runId: string) => setKin({ runDetail: runId }), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const hasBanner = useKin((s) => s.pendingApprovals.length > 0);
  const composing = useKin((s) => s.composing);
  const wide = useWide();

  return (
    <div className={`screen chat ${hasBanner ? "has-banner" : ""} ${composing ? "composing" : ""}`}>
      <ChatHeader
        state={state}
        status={ts?.status ?? ""}
        title={thread?.title ?? ""}
        isMain={thread?.main ?? true}
        onMenu={() => setDrawer(true)}
        onProfile={() => setKin({ profileOpen: true })}
        onNew={() => newThread()}
      />
      <ApprovalBanner />
      {count === 0 && <EmptyThread name={agentName} />}
      {threadId && (
        <MessageList
          key={threadId}
          threadId={threadId}
          menuId={menu?.m.id ?? null}
          onMenu={onMenu}
          onReply={onReply}
          onOpenRun={onOpenRun}
          scrollToBottomSignal={bottomSignal}
        />
      )}
      <Composer key={`composer-${threadId}`} busy={isBusy(raw)} reply={reply} onCancelReply={() => setReply(null)} onSent={() => setBottomSignal((n) => n + 1)} />
      <ReactionMenu target={menu} onClose={closeMenu} onReply={onReply} />
      {!wide && <ThreadDrawer open={drawer} onClose={() => setDrawer(false)} />}
    </div>
  );
}
