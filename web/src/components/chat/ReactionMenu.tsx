import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import type { Message } from "@shared/api";
import { toggleReaction } from "../../lib/actions";
import { tick } from "../../lib/haptics";
import { toast } from "../../lib/store";
import { I } from "../Icons";
import { BubbleBody, ReactionChips, Tail } from "./Bubble";
import { EMOJI, TAPBACKS } from "./emoji";
import { safeInsets } from "../../lib/viewport";

export interface MenuTarget {
  m: Message;
  rect: DOMRect;
  quote?: Message | null;
}

interface Props {
  target: MenuTarget | null;
  onClose: () => void;
  onReply: (m: Message) => void;
}

const BAR_H = 52;
const GAP = 10;
const ACTIONS_H = 98;
const PICKER_H = 330;

export function ReactionMenu({ target, onClose, onReply }: Props) {
  const root = document.getElementById("overlay-root");
  return root ? createPortal(<AnimatePresence>{target && <Menu key={target.m.id} target={target} onClose={onClose} onReply={onReply} />}</AnimatePresence>, root) : null;
}

function Menu({ target, onClose, onReply }: { target: MenuTarget; onClose: () => void; onReply: (m: Message) => void }) {
  const { m, rect, quote } = target;
  const side = m.role === "user" ? "user" : "agent";
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");
  const mine = m.reactions.find((r) => r.by === "user")?.emoji;

  // Everything is positioned inside the app frame (which is offset on desktop).
  const layout = useMemo(() => {
    const app = document.querySelector(".app")?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
    // Leave room for the status bar above the tapbacks and the action list below the bubble.
    const safe = safeInsets();
    const minTop = Math.max(safe.top, 20) + 8 + BAR_H + GAP;
    const maxBottom = app.height - Math.max(safe.bottom, 12) - 16 - ACTIONS_H - GAP;
    const from = rect.top - app.top;
    const top = Math.max(minTop, Math.min(from, maxBottom - rect.height));
    // With the emoji panel up, the bubble rides above it.
    const pickerTop = Math.max(minTop - BAR_H, Math.min(top, app.height - PICKER_H - safe.bottom - rect.height - 24));
    const h = side === "user" ? { right: app.right - rect.right } : { left: rect.left - app.left };
    return { top, from, h, pickerTop };
  }, [rect, side]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (emoji: string) => {
    tick(10);
    toggleReaction(m, emoji);
    onClose();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? EMOJI.filter(([, n]) => n.includes(q)) : EMOJI;
  }, [query]);

  const hAnchor = layout.h;

  return (
    <motion.div className="rmenu" initial={{ opacity: 1 }} exit={{ opacity: 1 }}>
      <motion.div
        className="rmenu-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        onClick={onClose}
      />

      <motion.div
        className={`rmenu-bubble brow ${side}`}
        style={{ top: layout.from, ...hAnchor, width: rect.width, originX: side === "user" ? 1 : 0, originY: 0.5 }}
        initial={{ y: 0, scale: 1 }}
        animate={{ y: (picker ? layout.pickerTop : layout.top) - layout.from, scale: 1.04 }}
        exit={{ y: 0, scale: 1, transition: { type: "spring", stiffness: 380, damping: 34 } }}
        transition={{ type: "spring", stiffness: 340, damping: 26 }}
      >
        <div className={`bubble ${side} has-tail lifted ${m.reactions.length ? "has-reaction" : ""}`}>
          <BubbleBody m={m} quote={quote} />
          <Tail side={side} />
          <ReactionChips reactions={m.reactions} side={side} />
        </div>
      </motion.div>

      <motion.div
        className="tapback-bar"
        role="menu"
        aria-label="React"
        style={{ top: layout.top - BAR_H - GAP - (m.reactions.length ? 10 : 0), ...hAnchor, originX: side === "user" ? 1 : 0, originY: 1, pointerEvents: picker ? "none" : "auto" }}
        initial={{ opacity: 0, scale: 0.6, y: 14 }}
        animate={picker ? { opacity: 0, scale: 0.8, y: 10 } : { opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.7, y: 10, transition: { duration: 0.14 } }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
      >
        {TAPBACKS.map((e, i) => (
          <motion.button
            key={e}
            type="button"
            role="menuitem"
            className={`tapback ${mine === e ? "on" : ""}`}
            aria-label={`React ${e}`}
            onClick={() => pick(e)}
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 22, delay: 0.04 * i }}
            whileTap={{ scale: 1.3 }}
          >
            {e}
          </motion.button>
        ))}
        <motion.button
          type="button"
          className={`tapback more ${mine && !TAPBACKS.includes(mine) ? "on" : ""}`}
          aria-label="More reactions"
          onClick={() => setPicker(true)}
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 22, delay: 0.2 }}
        >
          {mine && !TAPBACKS.includes(mine) ? mine : <I.Plus size={20} />}
        </motion.button>
      </motion.div>

      <motion.div
        className="rmenu-actions"
        role="menu"
        style={{ top: layout.top + rect.height * 1.04 + GAP, ...hAnchor, originX: side === "user" ? 1 : 0, originY: 0, pointerEvents: picker ? "none" : "auto" }}
        initial={{ opacity: 0, scale: 0.7 }}
        animate={picker ? { opacity: 0, scale: 0.8 } : { opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.12 } }}
        transition={{ type: "spring", stiffness: 380, damping: 30, delay: 0.04 }}
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onReply(m);
            onClose();
          }}
        >
          Reply <I.Reply size={19} />
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(m.text);
              toast("Copied");
            } catch {
              toast("Couldn't copy");
            }
            onClose();
          }}
        >
          Copy <I.Copy size={19} />
        </button>
      </motion.div>

      <AnimatePresence>
        {picker && (
          <motion.div
            className="emoji-panel"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
          >
            <div className="emoji-search">
              <I.Search size={17} />
              <input
                type="search"
                placeholder="Search emoji"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search emoji"
              />
            </div>
            <div className="emoji-grid scroll">
              {filtered.map(([e, name]) => (
                <button key={e} type="button" className={mine === e ? "on" : ""} aria-label={name.split(" ")[0]} onClick={() => pick(e)}>
                  {e}
                </button>
              ))}
              {filtered.length === 0 && <p className="emoji-none">No emoji match "{query}"</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
