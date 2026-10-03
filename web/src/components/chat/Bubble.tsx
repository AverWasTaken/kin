import { memo, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Message, Reaction } from "@shared/api";
import { Markdown } from "../Markdown";
import { I } from "../Icons";
import { tick } from "../../lib/haptics";
import { canHover } from "../../lib/viewport";
import { useKin } from "../../lib/store";

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,3}$/u;

export function isEmojiOnly(text: string) {
  return text.length <= 24 && EMOJI_ONLY.test(text.trim());
}

/**
 * The iMessage hook: drawn, not masked, so it works over any background. It replaces the
 * bubble's corner on that side (chat.css squares it off) and never shares an edge with the
 * bubble: its inner edges sit 1.5px inside it, so the bubble alone draws its side and bottom
 * (coincident anti-aliased edges leave a seam at fractional display scales). The hook flares
 * out of the side and its underside meets the bottom edge flat. 17px tall, so on a one-line
 * bubble it starts below the rounded end.
 */
export function Tail({ side }: { side: "user" | "agent" }) {
  return (
    <svg className={`tail tail-${side}`} width="22" height="17" viewBox="0 0 22 17" aria-hidden="true">
      <path d="M14.5 0V5C14.5 10.5 17.6 14.6 22 16.6C20 17.05 17.6 17 16 17L14.5 15.5Z" fill="currentColor" />
    </svg>
  );
}

export function ReactionChips({ reactions, side }: { reactions: Reaction[]; side: "user" | "agent" }) {
  return (
    <div className={`reactions on-${side}`}>
      <AnimatePresence initial={false}>
        {reactions.map((r) => (
          <motion.span
            key={`${r.by}-${r.emoji}`}
            className={`reaction by-${r.by}`}
            initial={{ scale: 0.3, opacity: 0, rotate: -15 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.3, opacity: 0, transition: { duration: 0.25, ease: "easeIn" } }}
            transition={{ type: "spring", stiffness: 200, damping: 17, mass: 1 }}
            aria-label={`${r.by === "user" ? "You" : "Agent"} reacted ${r.emoji}`}
          >
            {r.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function BubbleBody({ m, quote }: { m: Message; quote?: Message | null }) {
  const agentName = useKin((s) => s.agent.name);
  const big = !m.attachments?.length && !quote && isEmojiOnly(m.text);
  return (
    <>
      {quote && (
        <div className="quote">
          <span className="quote-who">{quote.role === "user" ? "You" : agentName}</span>
          <span className="quote-text">{quote.text}</span>
        </div>
      )}
      {!!m.attachments?.length && (
        <div className="attachments">
          {m.attachments.map((a) =>
            a.mime.startsWith("image/") ? (
              <img key={a.id} src={a.url} alt={a.name} loading="lazy" />
            ) : (
              <a key={a.id} className="file-chip" href={a.url} target="_blank" rel="noreferrer">
                <I.File size={18} /> {a.name}
              </a>
            ),
          )}
        </div>
      )}
      {m.text &&
        (big ? (
          <span className="emoji-big">{m.text}</span>
        ) : m.role === "agent" ? (
          <Markdown text={m.text} />
        ) : (
          <span className="plain">{m.text}</span>
        ))}
    </>
  );
}

interface BubbleProps {
  m: Message;
  tail: boolean;
  quote?: Message | null;
  dimmed?: boolean;
  onMenu: (m: Message, el: HTMLElement) => void;
  onReply: (m: Message) => void;
  onHeart: (m: Message) => void;
}

const LONG_PRESS = 380;
const SWIPE_REPLY = 60;

/**
 * Bubble row. Gestures are hand-rolled pointer handlers that write transforms straight to
 * the DOM: no motion projection node per row, so nothing re-measures the list while it
 * renders. Swipe right to reply, long-press (or right-click) for the menu, double-tap ❤️.
 */
function BubbleImpl({ m, tail, quote, dimmed, onMenu, onReply, onHeart }: BubbleProps) {
  const side = m.role === "user" ? "user" : "agent";
  const row = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const icon = useRef<HTMLSpanElement>(null);
  const g = useRef({ t: undefined as ReturnType<typeof setTimeout> | undefined, down: false, x: 0, y: 0, fired: false, swiping: false, gaveUp: false, dx: 0 });
  const lastTap = useRef(0);
  const big = !m.attachments?.length && !quote && isEmojiOnly(m.text);
  const local = m.id.startsWith("local-");

  const cancelPress = () => clearTimeout(g.current.t);

  const setOffset = (dx: number, animate: boolean) => {
    const r = row.current;
    const i = icon.current;
    if (!r || !i) return;
    const t = animate ? "transform 0.38s cubic-bezier(0.3, 1.3, 0.5, 1), opacity 0.2s" : "none";
    r.style.transition = t;
    i.style.transition = t;
    r.style.transform = dx ? `translateX(${dx}px)` : "";
    const p = Math.max(0, Math.min(1, (dx - 12) / (SWIPE_REPLY - 12)));
    i.style.opacity = String(p);
    i.style.transform = `scale(${0.5 + p * 0.5})`;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    g.current = { t: undefined, down: true, x: e.clientX, y: e.clientY, fired: false, swiping: false, gaveUp: false, dx: 0 };
    g.current.t = setTimeout(() => {
      g.current.fired = true;
      tick(10);
      if (ref.current) onMenu(m, ref.current);
    }, LONG_PRESS);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s.down) return; // a mouse hovering, not a press
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.hypot(dx, dy) > 8) cancelPress();
    if (canHover || s.gaveUp || s.fired) return;
    if (!s.swiping) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) s.gaveUp = true; // it's a scroll
      else if (dx > 10 && dx > Math.abs(dy) * 1.5) {
        s.swiping = true;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }
      if (!s.swiping) return;
    }
    // Rubber-band: follows the finger, then resists.
    s.dx = dx <= 0 ? 0 : dx < SWIPE_REPLY ? dx : SWIPE_REPLY + (dx - SWIPE_REPLY) * 0.3;
    setOffset(s.dx, false);
  };
  const endSwipe = () => {
    const s = g.current;
    s.down = false;
    if (!s.swiping) return false;
    s.swiping = false;
    if (s.dx >= SWIPE_REPLY) {
      tick(10);
      onReply(m);
    }
    setOffset(0, true);
    return true;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    cancelPress();
    if (endSwipe()) return;
    if (g.current.fired || (e.target as HTMLElement).closest("a")) return;
    const now = performance.now();
    if (now - lastTap.current < 300 && !local) {
      lastTap.current = 0;
      tick(12);
      onHeart(m);
    } else lastTap.current = now;
  };

  return (
    <div className={`brow ${side}`} ref={row}>
      <span className="swipe-reply" ref={icon} aria-hidden="true">
        <I.Reply size={18} />
      </span>
      <div
        ref={ref}
        className={`bubble ${side} ${tail ? "has-tail" : ""} ${big ? "big" : ""} ${m.reactions.length ? "has-reaction" : ""} ${dimmed ? "dimmed" : ""}`}
        data-mid={m.id}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          cancelPress();
          endSwipe();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          cancelPress();
          if (ref.current) onMenu(m, ref.current);
        }}
        onDoubleClick={() => canHover && !local && onHeart(m)}
      >
        <BubbleBody m={m} quote={quote} />
        {tail && !big && <Tail side={side} />}
        <ReactionChips reactions={m.reactions} side={side} />
      </div>
    </div>
  );
}

export const Bubble = memo(BubbleImpl);
