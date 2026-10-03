import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Message } from "@shared/api";
import { renderKey, revealDelay, useKin } from "../../lib/store";
import { loadOlder, toggleReaction } from "../../lib/actions";
import { clock, separator } from "../../lib/time";
import { Avatar } from "../Avatar";
import { I } from "../Icons";
import { Bubble } from "./Bubble";
import { ApprovalCard, NoticeRow, ReminderCard, TaskCard } from "./Cards";
import { TypingIndicator } from "./TypingIndicator";

const EMPTY: Message[] = [];
const GAP_SEPARATOR = 15 * 60_000;
const GAP_GROUP = 5 * 60_000;

type Row =
  | { kind: "sep"; key: string; at: number }
  | { kind: "msg"; key: string; m: Message; tail: boolean; first: boolean };

// Rows key on the id a message was first shown with, so an optimistic send that the server
// confirms updates in place instead of remounting (and replaying its entrance).

function buildRows(list: Message[]): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const p = list[i - 1];
    const n = list[i + 1];
    const sep = !p || m.createdAt - p.createdAt > GAP_SEPARATOR;
    if (sep) rows.push({ kind: "sep", key: `sep-${renderKey(m.id)}`, at: m.createdAt });
    const joins = (a: Message | undefined, b: Message | undefined) =>
      !!a && !!b && a.role === b.role && a.kind === "text" && b.kind === "text" && b.createdAt - a.createdAt < GAP_GROUP;
    const nextSep = n ? n.createdAt - m.createdAt > GAP_SEPARATOR : true;
    const first = sep || !joins(p, m);
    const tail = nextSep || !joins(m, n);
    rows.push({ kind: "msg", key: renderKey(m.id), m, tail, first });
  }
  return rows;
}

/* --------------------------------------------------------------- receipts */

const BUSY = new Set(["thinking", "typing", "working"]);

function receiptText(m: Message, busy: boolean) {
  if (m.id.startsWith("local-") && !m.status) return "Sending…";
  switch (m.status) {
    case "queued":
      return "Queued";
    case "sent":
      return "Sent";
    case "delivered":
      // Written to the agent but not consumed yet: it's waiting behind the current turn.
      return busy ? "Queued" : "Delivered";
    case "read":
      return `Read ${m.readAt ? clock(m.readAt) : ""}`.trim();
    default:
      return "Not delivered";
  }
}

/** iMessage's one line under your newest message: Delivered, then Read with the time. */
const ReceiptRow = memo(function ReceiptRow({ m, threadId }: { m: Message; threadId: string }) {
  // A boolean selector: this row re-renders only when "busy" flips, not on every state event.
  const busy = useKin((s) => BUSY.has(s.agentState[threadId]?.state ?? "idle"));
  const text = receiptText(m, busy);
  return (
    <div className="receipt-row">
      <span className="receipt-stack">
        <AnimatePresence initial={false}>
          <motion.span
            key={text}
            className={`receipt ${!m.status && !m.id.startsWith("local-") ? "failed" : ""}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {text}
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  );
});

/* ------------------------------------------------------------------ rows */

interface RowProps {
  m: Message;
  tail: boolean;
  first: boolean;
  quote: Message | null;
  enterDelay?: number;
  dimmed: boolean;
  receipt: boolean;
  agentName: string;
  onMenu: (m: Message, el: HTMLElement) => void;
  onReply: (m: Message) => void;
  onHeart: (m: Message) => void;
  onOpenRun: (runId: string) => void;
}

/**
 * A row that opens and closes by height (grid 0fr <-> 1fr), so nothing ever pops in or out.
 * `appear` mounts it shut and opens it a frame later, so it animates in (transitions don't run
 * on an element's first style).
 */
function Fold({ open, appear = false, className = "", children }: { open: boolean; appear?: boolean; className?: string; children: React.ReactNode }) {
  const [ready, setReady] = useState(!appear);
  useEffect(() => {
    if (ready) return;
    let id = requestAnimationFrame(() => (id = requestAnimationFrame(() => setReady(true))));
    return () => cancelAnimationFrame(id);
  }, [ready]);
  const shown = open && ready;
  return (
    <div className={`fold ${shown ? "open" : ""} ${className}`} aria-hidden={!shown || undefined}>
      <div className="fold-in">{children}</div>
    </div>
  );
}

const MessageRow = memo(function MessageRow(p: RowProps) {
  const { m, enterDelay } = p;
  const enter = enterDelay !== undefined;
  let body: React.ReactNode;
  if (m.kind === "task" && m.task) {
    body = (
      <div className="crow agent">
        <TaskCard m={m} onOpen={p.onOpenRun} />
      </div>
    );
  } else if (m.kind === "approval" && m.approval) {
    body = (
      <div className="crow agent">
        <ApprovalCard m={m} agentName={p.agentName} />
      </div>
    );
  } else if (m.kind === "reminder") {
    body = (
      <div className="crow agent">
        <ReminderCard m={m} />
      </div>
    );
  } else if (m.kind === "notice" || m.role === "system") {
    body = <NoticeRow m={m} />;
  } else {
    body = <Bubble m={m} tail={p.tail} quote={p.quote} dimmed={p.dimmed} onMenu={p.onMenu} onReply={p.onReply} onHeart={p.onHeart} />;
  }
  // A new row grows open from nothing, so everything above glides up as it makes room, and
  // its bubble blooms inside it. Pure CSS, keyed off .enter; --d staggers multi-bubble replies.
  return (
    <>
      <div
        className={`mrow ${p.first ? "g-first" : "g-cont"} ${enter ? `enter ${m.role === "user" ? "from-user" : "from-agent"}` : ""}`}
        style={enter && enterDelay ? ({ "--d": `${enterDelay}s` } as React.CSSProperties) : undefined}
      >
        <div className="mrow-in">
          {m.source === "background" && p.first && m.role === "agent" && m.kind === "text" && (
            <div className="source-tag">
              <I.Sparkle size={11} /> Checked in on its own
            </div>
          )}
          {body}
        </div>
      </div>
      {m.role === "user" && (
        <Fold open={p.receipt} appear={enter} className="receipt-fold">
          <ReceiptRow m={m} threadId={m.threadId} />
        </Fold>
      )}
    </>
  );
});

/** Only this row listens to agent.state, so state events never re-render the message list. */
const TypingRow = memo(function TypingRow({ threadId }: { threadId: string }) {
  const variant = useKin((s) => {
    const t = s.agentState[threadId];
    if (!t || t.answered || !BUSY.has(t.state)) return null;
    return t.state === "typing" ? "typing" : "thinking";
  });
  // Stays mounted and folds shut as the reply grows in above it, like the dots turning into it.
  const last = useRef<"typing" | "thinking">("thinking");
  if (variant) last.current = variant;
  return (
    <Fold open={!!variant} className="typing-fold">
      <TypingIndicator variant={last.current} />
    </Fold>
  );
});

/* ------------------------------------------------------------------ list */

interface Props {
  threadId: string;
  menuId: string | null;
  onMenu: (m: Message, el: HTMLElement) => void;
  onReply: (m: Message) => void;
  onOpenRun: (runId: string) => void;
  scrollToBottomSignal: number;
}

function MessageListImpl({ threadId, menuId, onMenu, onReply, onOpenRun, scrollToBottomSignal }: Props) {
  const list = useKin((s) => s.messages[threadId]) ?? EMPTY;
  const loaded = useKin((s) => threadId in s.messages);
  const hasMore = useKin((s) => !!s.hasMore[threadId]);
  const agentName = useKin((s) => s.agent.name);
  const agentAvatar = useKin((s) => s.agent.avatar);

  // The scroller is flex column-reverse: its scroll origin is the bottom, so the browser keeps
  // the newest message in view by itself (scrollTop 0 is the bottom, older is negative). No
  // pinning code, no scroll jumps; new rows animate their own height and the list follows.
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastHeight = useRef(0);
  const [pill, setPill] = useState(false);
  const known = useRef<{ ids: Set<string>; newest: number } | null>(null);
  const loadingOlder = useRef(false);
  const lastLen = useRef(0);
  const touchY = useRef<number | null>(null);

  // Messages on screen at first paint, and older history paged in later, never animate in.
  if (loaded && !known.current) {
    known.current = { ids: new Set(list.map((m) => m.id)), newest: list.reduce((n, m) => Math.max(n, m.createdAt), 0) };
  }

  const rows = useMemo(() => buildRows(list), [list]);
  const byId = useMemo(() => new Map(list.map((m) => [m.id, m])), [list]);

  const lastAgentIdx = useMemo(() => {
    for (let i = list.length - 1; i >= 0; i--) if (list[i].role === "agent") return i;
    return -1;
  }, [list]);
  const lastUserId = useMemo(() => {
    for (let i = list.length - 1; i > lastAgentIdx; i--) if (list[i].role === "user") return list[i].id;
    return null;
  }, [list, lastAgentIdx]);

  // Reading older messages: something new at the bottom shouldn't push the page you're on.
  // (Rows only animate in while you're at the bottom, so this is a single exact correction.)
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const grew = list.length > lastLen.current;
    lastLen.current = list.length;
    if (grew && !atBottom.current && lastHeight.current) {
      const mine = list[list.length - 1]?.role === "user";
      if (mine) el.scrollTo({ top: 0, behavior: "smooth" });
      else {
        el.scrollTop -= el.scrollHeight - lastHeight.current;
        setPill(true);
      }
    }
    lastHeight.current = el.scrollHeight;
  }, [list]);

  useEffect(() => {
    if (scrollToBottomSignal && !atBottom.current) scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [scrollToBottomSignal]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    lastHeight.current = el.scrollHeight;
    atBottom.current = el.scrollTop > -72;
    if (atBottom.current && pill) setPill(false);
    const fromTop = el.scrollHeight - el.clientHeight + el.scrollTop;
    if (fromTop < 400 && hasMore && !loadingOlder.current) {
      loadingOlder.current = true;
      // Prepending at the top never moves a bottom-anchored list.
      loadOlder(threadId).finally(() => (loadingOlder.current = false));
    }
  };

  // Dragging the conversation down puts the keyboard away, like Messages.
  const onTouchStart = (e: React.TouchEvent) => {
    touchY.current = e.touches[0]?.clientY ?? null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const y0 = touchY.current;
    const y = e.touches[0]?.clientY;
    if (y0 == null || y == null || y - y0 < 14) return;
    touchY.current = null;
    const a = document.activeElement as HTMLElement | null;
    if (a?.tagName === "TEXTAREA") a.blur();
  };

  const onHeart = useCallback((m: Message) => toggleReaction(m, "❤️"), []);

  return (
    <>
      <div className="thread-scroll scroll" ref={scroller} onScroll={onScroll} onTouchStart={onTouchStart} onTouchMove={onTouchMove}>
        <div className="thread">
          {!hasMore && loaded && list.length > 0 && (
            <div className="thread-start">
              <Avatar config={agentAvatar} size={56} state="idle" />
              <div className="thread-start-name">{agentName}</div>
              <div className="thread-start-sub">This is where it all started.</div>
            </div>
          )}
          {hasMore && (
            <div className="thread-loading" aria-hidden="true">
              <span className="spinner" />
            </div>
          )}
          {rows.map((r) => {
            if (r.kind === "sep") {
              const s = separator(r.at);
              return (
                <div key={r.key} className="sep">
                  <b>{s.day}</b> {s.time}
                </div>
              );
            }
            const m = r.m;
            const k = known.current;
            const isNew = !!k && !k.ids.has(m.id) && m.createdAt >= k.newest && atBottom.current;
            return (
              <MessageRow
                key={r.key}
                m={m}
                tail={r.tail}
                first={r.first}
                quote={m.replyTo ? (byId.get(m.replyTo) ?? null) : null}
                enterDelay={isNew ? (m.role === "agent" ? revealDelay(m.id) : 0) : undefined}
                dimmed={menuId === m.id}
                receipt={lastUserId === m.id}
                agentName={agentName}
                onMenu={onMenu}
                onReply={onReply}
                onHeart={onHeart}
                onOpenRun={onOpenRun}
              />
            );
          })}
          <TypingRow threadId={threadId} />
        </div>
      </div>

      <AnimatePresence>
        {pill && (
          <motion.button
            type="button"
            className="new-pill"
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.9 }}
            onClick={() => {
              setPill(false);
              scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <I.ArrowDown size={15} /> New messages
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}

export const MessageList = memo(MessageListImpl);
