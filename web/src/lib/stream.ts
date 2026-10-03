import type { StreamEvent } from "@shared/api";
import type { KinStream, StreamStatus } from "./api";

const SEQ_KEY = "kin.seq";

export function getLastSeq(): number {
  try {
    return Number(localStorage.getItem(SEQ_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function setLastSeq(seq: number) {
  try {
    localStorage.setItem(SEQ_KEY, String(seq));
  } catch {
    /* storage unavailable */
  }
}

/**
 * WebSocket to /api/stream. Reconnects with jittered exponential backoff and resumes
 * from the last seq it saw, so nothing is lost across sleeps and network changes.
 */
export const wsStream: KinStream = {
  connect(onEvent, onStatus, onReset) {
    let ws: WebSocket | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let seq = getLastSeq();

    const status = (s: StreamStatus) => !disposed && onStatus(s);

    const open = () => {
      if (disposed) return;
      clearTimeout(timer);
      status("connecting");
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/api/stream?since=${seq}`);
      ws.onopen = () => {
        attempt = 0;
        presence();
        status("open");
      };
      ws.onmessage = (m) => {
        let e: StreamEvent;
        try {
          e = JSON.parse(m.data);
        } catch {
          return;
        }
        if (!e || typeof e !== "object") return;
        // agent.state is ephemeral: it reuses the current seq and is never replayed, so it
        // bypasses the duplicate check and doesn't move the cursor.
        if (e.type !== "agent.state" && typeof e.seq === "number") {
          if (e.seq <= seq && e.seq !== 0) return; // replayed duplicate
          seq = e.seq;
          setLastSeq(seq);
        }
        try {
          onEvent(e);
        } catch (err) {
          console.error("kin: failed to apply event", e, err);
        }
      };
      ws.onclose = (ev) => {
        ws = null;
        if (disposed) return;
        if (ev.code === 4001) {
          // History we asked for is gone. Stop here; the owner refetches and reconnects.
          dispose();
          onReset?.();
          return;
        }
        status("closed");
        const delay = Math.min(15000, 500 * 2 ** attempt) * (0.7 + Math.random() * 0.6);
        attempt++;
        timer = setTimeout(open, delay);
      };
      ws.onerror = () => ws?.close();
    };

    // Tells the server whether we're on screen, so it pushes notifications while we're not.
    const presence = () => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "presence", visible: document.visibilityState === "visible" && document.hasFocus() }));
    };

    // Phones suspend sockets in the background; reconnect immediately when we come back.
    const wake = () => {
      presence();
      if (document.visibilityState === "visible" && (!ws || ws.readyState > 1)) {
        attempt = 0;
        open();
      }
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("focus", presence);
    window.addEventListener("blur", presence);
    window.addEventListener("pagehide", presence);

    const dispose = () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", presence);
      window.removeEventListener("blur", presence);
      window.removeEventListener("pagehide", presence);
      ws?.close();
    };

    open();
    return dispose;
  },
};
