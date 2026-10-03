import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Attachment, Message } from "@shared/api";
import { api } from "../../lib/client";
import { noteTyping, sendMessage, stopAgent } from "../../lib/actions";
import { setKin, toast, useKin } from "../../lib/store";
import { canHover } from "../../lib/viewport";
import { I } from "../Icons";

interface Pending {
  key: string;
  preview: string;
  file: File;
  done?: Attachment;
}

interface Props {
  busy: boolean;
  reply: Message | null;
  onCancelReply: () => void;
  onSent: () => void;
}

const DRAFT_KEY = (id: string) => `kin.draft.${id}`;
// Must match .composer-field textarea: 22px lines, 7px above and below (a 36px pill).
const LINE = 22;
const PAD = 7;
const MAX_LINES = 6;

export function Composer({ busy, reply, onCancelReply, onSent }: Props) {
  const threadId = useKin((s) => s.activeThreadId);
  const agentName = useKin((s) => s.agent.name);
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_KEY(threadId)) ?? "";
    } catch {
      return "";
    }
  });
  const [files, setFiles] = useState<Pending[]>([]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  // Publish our height so the thread can pad under us.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      requestAnimationFrame(() => document.documentElement.style.setProperty("--composer-h", `${el.offsetHeight}px`)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // While there's a draft the tab bar steps aside; it settles back once the field is empty.
  const drafting = text.trim().length > 0;
  useEffect(() => {
    setKin({ composing: drafting });
  }, [drafting]);
  useEffect(() => () => setKin({ composing: false }), []);

  useEffect(() => {
    try {
      if (text) localStorage.setItem(DRAFT_KEY(threadId), text);
      else localStorage.removeItem(DRAFT_KEY(threadId));
    } catch {
      /* storage unavailable */
    }
  }, [text, threadId]);

  useEffect(() => {
    if (reply) ta.current?.focus();
  }, [reply]);

  // Auto-grow in whole lines, up to 6. Snapping to the line grid keeps one line exactly
  // centred in the pill, and an empty field never measures (a hidden tab reports 0).
  const tab = useKin((s) => s.tab);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    let lines = 1;
    if (text) {
      el.style.height = "0px";
      lines = Math.max(1, Math.round((el.scrollHeight - 2 * PAD) / LINE));
    }
    el.style.height = `${Math.min(lines, MAX_LINES) * LINE + 2 * PAD}px`;
    el.style.overflowY = lines > MAX_LINES ? "auto" : "hidden";
  }, [text, tab]);

  // iOS blurs the field the instant a button is touched, so the keyboard dropped on every send.
  // Cancelling the touch keeps focus where it is (Messages-style); the tap is then handled on
  // touchend. This needs native non-passive listeners: React's touch handlers are passive.
  // Tapping the field: focus it ourselves with preventScroll, so iOS raises the keyboard without
  // sliding the whole page up to "reveal" it (the header used to ride that slide). A drag on the
  // field, or a tap while it already has focus (moving the caret), stays native.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      start = document.activeElement === el || !t ? null : { x: t.clientX, y: t.clientY };
    };
    const up = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!start || !t || Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) return;
      start = null;
      e.preventDefault();
      el.focus({ preventScroll: true });
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchend", up, { passive: false });
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchend", up);
    };
  }, []);

  const press = useRef<() => void>(() => {});
  const lastTouch = useRef(0);
  const sendRef = useCallback((el: HTMLButtonElement | null) => {
    if (!el) return;
    el.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    el.addEventListener(
      "touchend",
      (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        const r = el.getBoundingClientRect();
        // Only a release on the button counts; sliding off cancels, like a native button.
        if (t && t.clientX >= r.left - 8 && t.clientX <= r.right + 8 && t.clientY >= r.top - 8 && t.clientY <= r.bottom + 8) {
          lastTouch.current = performance.now();
          press.current();
        }
      },
      { passive: false },
    );
  }, []);

  const uploading = files.some((f) => !f.done);
  const canSend = (text.trim().length > 0 || files.length > 0) && !uploading;
  const showStop = busy && !canSend && text.trim().length === 0 && files.length === 0;

  const submit = () => {
    if (!canSend) return;
    const attachments = files.map((f) => f.done!).filter(Boolean);
    sendMessage(text.trim(), { replyTo: reply?.id, attachments });
    setText("");
    files.forEach((f) => URL.revokeObjectURL(f.preview));
    setFiles([]);
    onCancelReply();
    noteTyping(false);
    onSent();
    // Keep the keyboard up like Messages does; the tab bar returns once you leave the field.
    ta.current?.focus();
  };

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const added = [...list].slice(0, 6).map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, preview: URL.createObjectURL(file), file }));
    setFiles((f) => [...f, ...added]);
    for (const p of added) {
      try {
        const a = await api.upload(p.file);
        setFiles((f) => f.map((x) => (x.key === p.key ? { ...x, done: a } : x)));
      } catch {
        toast(`Couldn't upload ${p.file.name}`);
        setFiles((f) => f.filter((x) => x.key !== p.key));
      }
    }
  };

  press.current = showStop ? stopAgent : submit;

  return (
    <div className="composer" ref={root}>
      <AnimatePresence initial={false}>
        {reply && (
          <motion.div
            className="reply-chip"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 360, damping: 32 }}
          >
            <div className="reply-inner">
              <I.Reply size={15} />
              <div className="reply-text">
                <span className="reply-who">Replying to {reply.role === "user" ? "yourself" : agentName}</span>
                <span className="ellipsis">{reply.text}</span>
              </div>
              <button type="button" className="reply-x" aria-label="Cancel reply" onClick={onCancelReply}>
                <I.X size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {files.length > 0 && (
          <motion.div className="thumbs" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="thumbs-inner">
              {files.map((f) => (
                <motion.div key={f.key} className="thumb" layout initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                  <img src={f.preview} alt={f.file.name} />
                  {!f.done && (
                    <span className="thumb-busy">
                      <span className="spinner" />
                    </span>
                  )}
                  <button
                    type="button"
                    className="thumb-x"
                    aria-label={`Remove ${f.file.name}`}
                    onClick={() => setFiles((all) => all.filter((x) => x.key !== f.key))}
                  >
                    <I.X size={11} />
                  </button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="composer-row">
        <button type="button" className="composer-plus" aria-label="Add photo" onClick={() => fileInput.current?.click()}>
          <I.Plus size={20} />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="composer-field">
          <textarea
            ref={ta}
            rows={1}
            value={text}
            placeholder={`Message ${agentName}`}
            aria-label={`Message ${agentName}`}
            enterKeyHint="send"
            onChange={(e) => {
              setText(e.target.value);
              noteTyping(e.target.value.trim().length > 0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && canHover && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            onBlur={() => noteTyping(false)}
          />
          <AnimatePresence mode="popLayout" initial={false}>
            {(canSend || showStop) && (
              <motion.button
                key={showStop ? "stop" : "send"}
                type="button"
                className={`send-btn ${showStop ? "stop" : ""}`}
                aria-label={showStop ? "Stop" : "Send"}
                ref={sendRef}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  // A touch already fired on touchend; this is the mouse/keyboard path.
                  if (performance.now() - lastTouch.current > 600) press.current();
                }}
                initial={{ scale: 0.3, opacity: 0, rotate: showStop ? -90 : 0 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.3, opacity: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 22 }}
                whileTap={{ scale: 0.88 }}
              >
                {showStop ? <I.Stop size={14} /> : <I.ArrowUp size={18} />}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
