import { memo, useEffect, useId, useState } from "react";
import { motion, type Transition } from "motion/react";
import type { AgentState, AvatarConfig } from "@shared/api";
import { hexToRgb, luminance, shade } from "../lib/color";

type Shape = AvatarConfig["shape"];

interface Anchors {
  /** y of the head's top edge at the center line */
  top: number;
  eyeY: number;
  eyeDX: number;
  left: number;
  right: number;
  bottom: number;
}

function starPath(cx: number, cy: number, R: number, r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)} ${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(" L")} Z`;
}

const BODY: Record<Shape, { d: string; alt?: string; a: Anchors }> = {
  bean: {
    d: "M60 22 C81 22 90 40 90 62 C90 86 77 100 60 100 C43 100 30 86 30 62 C30 40 39 22 60 22 Z",
    a: { top: 22, eyeY: 56, eyeDX: 11, left: 31, right: 89, bottom: 100 },
  },
  cloud: {
    d: "M36 94 C22 94 17 82 23 73 C14 65 20 50 34 52 C33 38 47 30 58 36 C65 26 83 28 85 42 C98 42 102 58 94 66 C101 77 93 94 80 94 Z",
    a: { top: 34, eyeY: 64, eyeDX: 11, left: 21, right: 97, bottom: 94 },
  },
  blob: {
    d: "M58 24 C79 22 94 37 92 58 C90 78 84 98 60 98 C38 98 26 87 28 64 C30 44 38 26 58 24 Z",
    alt: "M61 23 C80 25 92 40 91 60 C90 80 80 99 58 98 C37 97 27 84 29 62 C31 41 41 21 61 23 Z",
    a: { top: 24, eyeY: 57, eyeDX: 11, left: 29, right: 92, bottom: 98 },
  },
  ghost: {
    d: "M30 60 C30 37 44 24 60 24 C76 24 90 37 90 60 L90 95 Q84 89 78 95 Q72 101 66 95 Q60 89 54 95 Q48 101 42 95 Q36 89 30 95 Z",
    a: { top: 24, eyeY: 54, eyeDX: 11, left: 30, right: 90, bottom: 96 },
  },
  cat: {
    d: "M33 52 L31 25 L51 39 C57 37 63 37 69 39 L89 25 L87 52 C94 64 92 85 80 93 C70 99 50 99 40 93 C28 85 26 64 33 52 Z",
    a: { top: 37, eyeY: 63, eyeDX: 12, left: 29, right: 91, bottom: 97 },
  },
  star: {
    d: starPath(60, 64, 42, 23),
    a: { top: 22, eyeY: 63, eyeDX: 9, left: 36, right: 84, bottom: 98 },
  },
};

const DARK_INK = "#1E2124";
const LIGHT_INK = "#F6F2EA";

export interface AvatarProps {
  config: AvatarConfig;
  state?: AgentState;
  size?: number;
  className?: string;
  /** Draws the soft ground shadow (large sizes). */
  ground?: boolean;
  title?: string;
}

const spring: Transition = { type: "spring", stiffness: 320, damping: 18 };

function Eyes({ kind, a, closed, happy, INK }: { kind: AvatarConfig["eyes"]; a: Anchors; closed: boolean; happy: boolean; INK: string }) {
  const one = (x: number) => {
    if (closed)
      return <path d={`M${x - 4.2} ${a.eyeY} Q${x} ${a.eyeY + 3.6} ${x + 4.2} ${a.eyeY}`} stroke={INK} strokeWidth={2.4} strokeLinecap="round" fill="none" />;
    if (happy || kind === "happy")
      return <path d={`M${x - 4.4} ${a.eyeY + 1.6} Q${x} ${a.eyeY - 4} ${x + 4.4} ${a.eyeY + 1.6}`} stroke={INK} strokeWidth={2.6} strokeLinecap="round" fill="none" />;
    if (kind === "sleepy")
      return (
        <g>
          <path d={`M${x - 4.4} ${a.eyeY - 0.5} A4.4 4.4 0 0 0 ${x + 4.4} ${a.eyeY - 0.5} Z`} fill={INK} />
          <path d={`M${x - 5} ${a.eyeY - 0.8} L${x + 5} ${a.eyeY - 1.6}`} stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
          <circle cx={x - 1.4} cy={a.eyeY + 1.2} r={1} fill="#fff" />
        </g>
      );
    if (kind === "diamond")
      return (
        <g>
          <rect x={x - 3.6} y={a.eyeY - 3.6} width={7.2} height={7.2} rx={1.4} transform={`rotate(45 ${x} ${a.eyeY})`} fill={INK} />
          <circle cx={x - 1.2} cy={a.eyeY - 1.6} r={1.2} fill="#fff" />
        </g>
      );
    return (
      <g>
        <ellipse cx={x} cy={a.eyeY} rx={3.7} ry={4.7} fill={INK} />
        <circle cx={x - 1.2} cy={a.eyeY - 1.8} r={1.3} fill="#fff" />
      </g>
    );
  };
  return (
    <>
      {one(60 - a.eyeDX)}
      {one(60 + a.eyeDX)}
    </>
  );
}

function Mouth({ a, state, INK }: { a: Anchors; state: AgentState; INK: string }) {
  const y = a.eyeY + 9;
  if (state === "done")
    return <path d={`M54.5 ${y - 1} Q60 ${y + 7} 65.5 ${y - 1} Z`} fill={INK} stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />;
  if (state === "asleep" || state === "thinking") return <ellipse cx={60} cy={y + 1} rx={1.8} ry={1.5} fill={INK} />;
  return <path d={`M56.5 ${y} Q60 ${y + 3.4} 63.5 ${y}`} stroke={INK} strokeWidth={2} strokeLinecap="round" fill="none" />;
}

function Accessory({ kind, a, color, INK }: { kind: AvatarConfig["accessory"]; a: Anchors; color: string; INK: string }) {
  const L = 60 - a.eyeDX;
  const R = 60 + a.eyeDX;
  switch (kind) {
    case "beret":
      return (
        <g transform={`rotate(-12 60 ${a.top})`}>
          <ellipse cx={63} cy={a.top + 1} rx={21} ry={7.5} fill="#3B3F5C" />
          <ellipse cx={63} cy={a.top + 3.5} rx={19} ry={3.5} fill="#2C2F47" />
          <path d={`M61 ${a.top - 6} q2 -5 4 -1`} stroke="#3B3F5C" strokeWidth={2.6} strokeLinecap="round" fill="none" />
        </g>
      );
    case "glasses":
      return (
        <g fill="rgba(255,255,255,0.22)" stroke={INK} strokeWidth={2}>
          <circle cx={L} cy={a.eyeY} r={7.6} />
          <circle cx={R} cy={a.eyeY} r={7.6} />
          <path d={`M${L + 7.6} ${a.eyeY - 1} Q60 ${a.eyeY - 4} ${R - 7.6} ${a.eyeY - 1}`} fill="none" />
        </g>
      );
    case "monocle":
      return (
        <g>
          <circle cx={R} cy={a.eyeY} r={8} fill="rgba(255,255,255,0.25)" stroke="#C9A227" strokeWidth={2.2} />
          <path d={`M${R + 5} ${a.eyeY + 6} C${R + 8} ${a.eyeY + 16} ${R + 2} ${a.eyeY + 20} ${R + 6} ${a.eyeY + 28}`} stroke="#C9A227" strokeWidth={1.2} fill="none" strokeDasharray="1.6 1.6" />
        </g>
      );
    case "bowtie": {
      const y = a.bottom - 15;
      return (
        <g>
          <path d={`M60 ${y} L48 ${y - 7} Q45 ${y} 48 ${y + 7} Z`} fill="#E5484D" />
          <path d={`M60 ${y} L72 ${y - 7} Q75 ${y} 72 ${y + 7} Z`} fill="#E5484D" />
          <rect x={56.5} y={y - 3.5} width={7} height={7} rx={2.2} fill="#C93A3F" />
        </g>
      );
    }
    case "headphones":
      return (
        <g>
          <path d={`M${a.left - 1} ${a.eyeY} C${a.left - 3} ${a.top - 18} ${a.right + 3} ${a.top - 18} ${a.right + 1} ${a.eyeY}`} stroke="#2D3139" strokeWidth={4.4} fill="none" strokeLinecap="round" />
          <rect x={a.left - 6} y={a.eyeY - 9} width={10} height={18} rx={4.5} fill="#2D3139" />
          <rect x={a.right - 4} y={a.eyeY - 9} width={10} height={18} rx={4.5} fill="#2D3139" />
          <rect x={a.left - 3.5} y={a.eyeY - 5} width={4} height={10} rx={2} fill={shade(color, 0.35)} />
          <rect x={a.right + 0.5} y={a.eyeY - 5} width={4} height={10} rx={2} fill={shade(color, 0.35)} />
        </g>
      );
    case "flower": {
      const cx = 79;
      const cy = a.top + 7;
      return (
        <g transform={`rotate(14 ${cx} ${cy})`}>
          {[0, 72, 144, 216, 288].map((r) => (
            <ellipse key={r} cx={cx} cy={cy - 5} rx={3.6} ry={5} fill="#FF8FB1" transform={`rotate(${r} ${cx} ${cy})`} />
          ))}
          <circle cx={cx} cy={cy} r={3.4} fill="#FFD45C" />
        </g>
      );
    }
    default:
      return null;
  }
}

function Laptop({ color, working }: { color: string; working: boolean }) {
  const hand = shade(color, 0.08);
  return (
    <motion.g
      initial={{ y: 26, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 26, opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
    >
      <rect x={37} y={75} width={46} height={27} rx={3.5} fill="#3B4150" />
      <rect x={37} y={75} width={46} height={3} rx={1.5} fill="#596073" />
      <circle cx={60} cy={88.5} r={2.6} fill="#C9CED8" />
      <path d="M31 102 L89 102 L85.5 106.5 L34.5 106.5 Z" fill="#8E95A4" />
      <g className={working ? "av-tap av-tap-fast" : "av-tap"}>
        <circle className="av-hand-l" cx={46} cy={75.5} r={4.4} fill={hand} stroke={shade(color, -0.3)} strokeWidth={1} />
        <circle className="av-hand-r" cx={74} cy={75.5} r={4.4} fill={hand} stroke={shade(color, -0.3)} strokeWidth={1} />
      </g>
      {working && (
        <g fill="#FFC53D">
          <path className="av-spark av-spark-1" d="M88 70 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 Z" />
          <path className="av-spark av-spark-2" d="M30 76 l1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2 Z" />
          <path className="av-spark av-spark-3" d="M94 88 l1 2.4 2.4 1 -2.4 1 -1 2.4 -1 -2.4 -2.4 -1 2.4 -1 Z" />
        </g>
      )}
    </motion.g>
  );
}

function pose(state: AgentState) {
  switch (state) {
    case "listening":
      return { rotate: 7, y: 2, x: 1 };
    case "reading":
      return { rotate: 3, y: 1, x: 0 };
    case "thinking":
      return { rotate: -5, y: 0, x: 0 };
    case "typing":
    case "working":
      return { rotate: 0, y: 3, x: 0 };
    case "asleep":
      return { rotate: 9, y: 4, x: 0 };
    default:
      return { rotate: 0, y: 0, x: 0 };
  }
}

function gaze(state: AgentState) {
  switch (state) {
    case "listening":
      return { x: 1.6, y: 2.4 };
    case "thinking":
      return { x: -2, y: -3 };
    case "typing":
    case "working":
      return { x: 0, y: 2.6 };
    default:
      return { x: 0, y: 0 };
  }
}

function AvatarImpl({ config, state = "idle", size = 36, className, ground, title }: AvatarProps) {
  const uid = useId().replace(/[:«»]/g, "");
  const body = BODY[config.shape] ?? BODY.bean;
  const a = body.a;
  const mini = size <= 22;
  const [blink, setBlink] = useState(false);
  const [hop, setHop] = useState(0);

  useEffect(() => {
    if (mini || state === "asleep") return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(
        () => {
          setBlink(true);
          setTimeout(() => setBlink(false), 130);
          loop();
        },
        2200 + Math.random() * 4200,
      );
    };
    loop();
    return () => clearTimeout(t);
  }, [mini, state]);

  useEffect(() => {
    if (state === "done") setHop((h) => h + 1);
  }, [state]);

  const color = config.color;
  // Dark bodies get light eyes so the face never disappears.
  const ink = luminance(hexToRgb(color)) < 0.16 ? LIGHT_INK : DARK_INK;
  const p = pose(state);
  const g = gaze(state);
  const showLaptop = !mini && (state === "typing" || state === "working");
  const closed = state === "asleep";

  return (
    <svg
      className={`av ${mini ? "" : "av-breathe"} ${className ?? ""}`}
      data-state={state}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label={title ?? "Agent avatar"}
      style={{ overflow: "visible" }}
    >
      <defs>
        <radialGradient id={`g${uid}`} cx="36%" cy="28%" r="78%">
          <stop offset="0%" stopColor={shade(color, 0.32)} />
          <stop offset="55%" stopColor={color} />
          <stop offset="100%" stopColor={shade(color, -0.16)} />
        </radialGradient>
      </defs>

      {ground && (
        <motion.ellipse
          cx={60}
          cy={106}
          rx={28}
          ry={4.5}
          fill="currentColor"
          opacity={0.1}
          key={`s${hop}`}
          animate={state === "done" ? { scaleX: [1, 0.7, 1], opacity: [0.1, 0.05, 0.1] } : {}}
          transition={{ duration: 0.6 }}
          style={{ originX: 0.5, originY: 0.5 }}
        />
      )}

      <motion.g
        key={`h${hop}`}
        animate={
          state === "done"
            ? { y: [0, -14, 0, -4, 0], scaleY: [1, 1.04, 0.94, 1.01, 1] }
            : { y: 0, scaleY: 1 }
        }
        transition={{ duration: 0.75, ease: "easeOut" }}
        style={{ originX: 0.5, originY: 1 }}
      >
        <motion.g
          animate={{ rotate: p.rotate, y: p.y, x: p.x }}
          transition={spring}
          style={{ originX: 0.5, originY: 1 }}
        >
          <g>
            {body.alt && !mini ? (
              <motion.path
                d={body.d}
                animate={{ d: [body.d, body.alt, body.d] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                fill={`url(#g${uid})`}
                stroke={shade(color, -0.1)}
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
            ) : (
              <path d={body.d} fill={`url(#g${uid})`} stroke={config.shape === "star" ? color : shade(color, -0.1)} strokeWidth={config.shape === "star" ? 7 : 2.5} strokeLinejoin="round" />
            )}
            {!mini && (
              <ellipse
                cx={60 - a.eyeDX - 6}
                cy={a.top + 12}
                rx={7}
                ry={4.2}
                fill="#fff"
                opacity={0.28}
                transform={`rotate(-28 ${60 - a.eyeDX - 6} ${a.top + 12})`}
              />
            )}
            {!mini && (
              <g fill="#FF8FA8" opacity={0.55}>
                <ellipse cx={60 - a.eyeDX - 7} cy={a.eyeY + 8} rx={5} ry={3} />
                <ellipse cx={60 + a.eyeDX + 7} cy={a.eyeY + 8} rx={5} ry={3} />
              </g>
            )}
            <motion.g animate={{ x: g.x, y: g.y }} transition={{ type: "spring", stiffness: 260, damping: 22 }}>
              <g className={state === "reading" ? "av-scan" : undefined}>
                <g
                  style={{
                    transformBox: "fill-box",
                    transformOrigin: "center",
                    transform: blink ? "scaleY(0.12)" : "scaleY(1)",
                    transition: "transform 70ms ease-out",
                  }}
                >
                  <Eyes kind={config.eyes} a={a} closed={closed} happy={state === "done"} INK={ink} />
                </g>
              </g>
              {!mini && <Mouth a={a} state={state} INK={ink} />}
            </motion.g>
            {!mini && <Accessory kind={config.accessory} a={a} color={color} INK={ink} />}
            {mini && config.accessory === "glasses" && <Accessory kind="glasses" a={a} color={color} INK={ink} />}
          </g>
        </motion.g>
        {showLaptop && <Laptop color={color} working={state === "working"} />}
      </motion.g>

      {!mini && state === "thinking" && (
        <g className="av-orbit" style={{ transformOrigin: `60px ${a.eyeY}px` }}>
          <circle cx={60} cy={a.top - 14} r={3.2} fill="currentColor" opacity={0.55} />
          <circle cx={60 + 42} cy={a.eyeY} r={2.4} fill="currentColor" opacity={0.4} />
          <circle cx={60 - 36} cy={a.eyeY + 22} r={2} fill="currentColor" opacity={0.3} />
        </g>
      )}
      {!mini && state === "asleep" && (
        <g fill="currentColor" fontFamily="ui-rounded, Nunito, system-ui" fontWeight={800}>
          <text className="av-z av-z-1" x={86} y={a.top + 6} fontSize={13}>z</text>
          <text className="av-z av-z-2" x={94} y={a.top - 6} fontSize={10}>z</text>
          <text className="av-z av-z-3" x={100} y={a.top - 16} fontSize={8}>z</text>
        </g>
      )}
      {!mini && state === "done" && (
        <g fill="#FFC53D" key={`d${hop}`}>
          <path className="av-pop av-pop-1" d="M24 34 l1.8 4.4 4.4 1.8 -4.4 1.8 -1.8 4.4 -1.8 -4.4 -4.4 -1.8 4.4 -1.8 Z" />
          <path className="av-pop av-pop-2" d="M98 30 l1.4 3.4 3.4 1.4 -3.4 1.4 -1.4 3.4 -1.4 -3.4 -3.4 -1.4 3.4 -1.4 Z" />
        </g>
      )}
    </svg>
  );
}

export const Avatar = memo(AvatarImpl);

export const AVATAR_COLORS = ["#57C4A4", "#F5B841", "#FF7A5C", "#5AA9F0", "#B79CF2", "#FF8FC1", "#8DB255", "#E9DCC3", "#3E4A6B"];
export const AVATAR_SHAPES: Shape[] = ["bean", "cloud", "blob", "ghost", "cat", "star"];
export const AVATAR_EYES: AvatarConfig["eyes"][] = ["dot", "diamond", "happy", "sleepy"];
export const AVATAR_ACCESSORIES: AvatarConfig["accessory"][] = ["none", "beret", "glasses", "bowtie", "monocle", "headphones", "flower"];
