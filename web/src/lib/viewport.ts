import { useSyncExternalStore } from "react";
import { setKin } from "./store";

const KB_KEY = "kin.kb-height";
// A predicted slide waits for iOS to report the keyboard (about 95ms after focus on an iPhone,
// right as it starts to rise) but no longer than this.
const KB_LEAD = 300;
// Text fields that raise the software keyboard (pickers like time/date don't).
const TYPING =
  'textarea, [contenteditable="true"], input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]):not([type=time]):not([type=date]):not([type=color])';

function isEditing() {
  const el = document.activeElement;
  return !!el && el.matches(TYPING);
}

/**
 * iOS doesn't resize the layout viewport for the keyboard; it pans the page up to keep the
 * field visible, and visualViewport only reports in once the keyboard is up. Following that
 * late meant the whole app slid up, then snapped back down to show the header.
 *
 * So on iOS we get there first: the moment a text field takes focus, the app shrinks
 * to where the keyboard is about to be (last measured height, or a guess), animated on the
 * same spring as the keyboard. The field is already above the keyboard, so iOS never pans,
 * and the real measurement only nudges it. Closing works the same way in reverse.
 * Exposes --app-h / --app-top and the kb-open flag.
 */
export function trackViewport() {
  const vv = window.visualViewport;
  const root = document.documentElement;
  let raf = 0;
  let predicted = false; // the layout is waiting on a keyboard we expect
  let predictTimer: ReturnType<typeof setTimeout> | undefined;

  const fullH = () => Math.max(root.clientHeight, window.innerHeight);
  const kbGuess = () => {
    let saved = 0;
    try {
      saved = Number(localStorage.getItem(KB_KEY)) || 0;
    } catch {
      /* storage unavailable */
    }
    return saved || Math.round(screen.height * 0.45);
  };

  /**
   * Applies the new shell size in one layout, then slides the conversation and composer from
   * where they were on screen (FLIP) with compositor transforms.
   *
   * Shrinking for the keyboard would clip them: they'd slide inside a box that is already
   * short. So while the slide runs, the chat screen keeps extending down to full height
   * (--kb-ext, .kb-anim, painted with its own background) and everything rises by that much;
   * when the slide ends the extension is dropped, which lands every pixel exactly where the
   * transforms already put it.
   */
  let gen = 0;
  let commitTimer: ReturnType<typeof setTimeout> | undefined;
  // A predicted slide waiting for iOS to report the keyboard (see predictOpen).
  let pending: (() => void) | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  const startPending = () => {
    clearTimeout(pendingTimer);
    const go = pending;
    pending = null;
    go?.();
  };

  /**
   * `hold`: lay out for the keyboard now but keep everything visually where it was, and only
   * start the slide once iOS reports the keyboard, which (per a trace from the phone) arrives
   * about 95ms after focus, just as the keyboard starts to move: starting there is in sync.
   */
  const apply = (h: number, top: number, kb: boolean, hold = false) => {
    const nextH = `${Math.round(h)}px`;
    const nextTop = `${Math.round(top)}px`;
    const same =
      root.style.getPropertyValue("--app-h") === nextH &&
      root.style.getPropertyValue("--app-top") === nextTop &&
      root.classList.contains("kb-open") === kb;
    if (same) {
      if (!hold) startPending();
      return;
    }

    const animate = isIOS;
    const composer = animate ? document.querySelector<HTMLElement>(".composer") : null;
    const scroll = animate ? document.querySelector<HTMLElement>(".thread-scroll") : null;
    const thread = scroll?.querySelector<HTMLElement>(".thread") ?? null;
    // Where things are on screen right now, mid-slide or held included.
    const c0 = composer?.getBoundingClientRect().top ?? 0;
    const b0 = thread?.getBoundingClientRect().bottom ?? 0;
    for (const el of [composer, scroll]) {
      if (!el) continue;
      el.style.transition = "none";
      el.style.transform = "";
    }
    clearTimeout(commitTimer);
    pending = null;
    clearTimeout(pendingTimer);

    const ext = Math.max(0, Math.round(fullH() - h));
    root.style.setProperty("--app-h", nextH);
    root.style.setProperty("--app-top", nextTop);
    root.classList.toggle("kb-open", kb);
    setKin({ keyboardOpen: kb });

    const id = ++gen;
    if (!composer || !scroll || !thread) {
      root.classList.remove("kb-anim");
      return;
    }
    root.style.setProperty("--kb-ext", `${ext}px`);
    root.classList.add("kb-anim");
    const c1 = composer.getBoundingClientRect().top;
    const b1 = thread.getBoundingClientRect().bottom;
    const rest = getComputedStyle(composer).transform;
    const end = rest === "none" ? "" : rest;
    // Hold everything where it was on screen (inline, no transition yet).
    composer.style.transform = `translateY(${c0 - c1}px) ${end}`;
    scroll.style.transform = `translateY(${b0 - b1}px)`;

    // The slide is a plain CSS transition: on the phone, script-driven (Web Animations) slides
    // were marked finished one frame after starting, while CSS motion runs normally. The
    // composer and the thread rise together on a from-rest spring curve. (The field is focused
    // with preventScroll, see Composer.tsx, so iOS doesn't pan the page to reveal it meanwhile.)
    const go = () => {
      if (id !== gen) return;
      composer.getBoundingClientRect(); // commit the held position before transitioning from it
      const t = "transform var(--spring-glide-ms) var(--spring-glide)";
      composer.style.transition = t;
      scroll.style.transition = t;
      composer.style.transform = end || "none";
      scroll.style.transform = `translateY(${-ext}px)`;
      const ms = parseFloat(getComputedStyle(root).getPropertyValue("--spring-glide-ms")) || 520;
      commitTimer = setTimeout(() => {
        if (id !== gen) return;
        // Commit: drop the extension and the inline transforms together; nothing moves.
        root.classList.remove("kb-anim");
        for (const el of [composer, scroll]) {
          el.style.transition = "none";
          el.style.transform = "";
        }
      }, ms + 40);
    };
    if (hold) {
      pending = go;
      // If iOS never reports a keyboard in time, go anyway.
      pendingTimer = setTimeout(startPending, KB_LEAD);
    } else go();
  };

  const measure = () => {
    const h = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;
    if (!isIOS) {
      apply(h, top, window.innerHeight - h > 120 || (isEditing() && h < screen.height * 0.62));
    } else {
      const editing = isEditing();
      const kbH = fullH() - h;
      if (editing && kbH > 120) {
        predicted = false;
        clearTimeout(predictTimer);
        try {
          localStorage.setItem(KB_KEY, String(Math.round(kbH)));
        } catch {
          /* storage unavailable */
        }
        apply(h, top, true);
      } else if (editing && predicted) {
        // The keyboard is still on its way: hold the predicted layout.
      } else {
        // No keyboard is up without a focused field, even while it animates away.
        apply(Math.max(h, fullH()), 0, false);
      }
    }
    // We never want the document itself to move, keyboard or not.
    if (window.scrollY !== 0) window.scrollTo(0, 0);
  };
  const update = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(measure);
  };

  const predictOpen = () => {
    if (!isIOS || root.classList.contains("kb-open")) return;
    predicted = true;
    clearTimeout(predictTimer);
    // No keyboard turning up (a hardware keyboard) falls back after a beat.
    predictTimer = setTimeout(() => {
      predicted = false;
      update();
    }, 1200);
    apply(fullH() - kbGuess(), 0, true, true);
  };

  // Predict on focus, not on touch: moving the field while the finger is still down makes
  // the tap miss it (no focus, no keyboard). Focus lands before iOS works out its pan.
  document.addEventListener("focusin", (e) => {
    if ((e.target as Element).matches?.(TYPING)) {
      predictOpen();
    }
    update();
  });
  // Moving focus between fields keeps the keyboard; only a real blur closes it.
  document.addEventListener("focusout", () =>
    setTimeout(() => {
      if (isEditing()) return;
      measure();
    }, 0),
  );

  measure();
  vv?.addEventListener("resize", () => {
    update();
  });
  vv?.addEventListener("scroll", () => {
    update();
  });
  window.addEventListener("resize", update);
  // If iOS nudges the page anyway, put it straight back rather than letting the header ride it.
  window.addEventListener("scroll", () => window.scrollY !== 0 && window.scrollTo(0, 0), { passive: true });
}

export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
export const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/** Measures the resolved safe-area insets (env() can't be read from script directly). */
export function safeInsets() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;visibility:hidden;top:0;left:0;height:var(--safe-t);width:var(--safe-b)";
  document.body.appendChild(probe);
  const r = { top: probe.offsetHeight, bottom: probe.offsetWidth };
  probe.remove();
  return r;
}

/** Desktop-sized window: the app lays out like Messages on a Mac (sidebar + conversation). */
const wideQuery = window.matchMedia("(min-width: 900px) and (min-height: 560px)");
export function useWide() {
  return useSyncExternalStore(
    (cb) => {
      wideQuery.addEventListener("change", cb);
      return () => wideQuery.removeEventListener("change", cb);
    },
    () => wideQuery.matches,
  );
}

/** A --spring-* curve from tokens.css as Web Animations timing. */
const timings: Record<string, KeyframeAnimationOptions> = {};
export function springTiming(kind: "glide" | "soft" | "pop" | "bubble" | "kb"): KeyframeAnimationOptions {
  if (!timings[kind]) {
    const css = getComputedStyle(document.documentElement);
    const easing = css.getPropertyValue(`--spring-${kind}`).trim();
    timings[kind] = { duration: parseFloat(css.getPropertyValue(`--spring-${kind}-ms`)) || 520, easing: "cubic-bezier(0.25, 0.8, 0.25, 1)" };
    try {
      document.createElement("div").animate([], { easing });
      timings[kind].easing = easing;
    } catch {
      /* no linear() easing in this browser: keep the cubic fallback */
    }
  }
  return timings[kind];
}
