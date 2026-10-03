import type { ReactNode, SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const I = {
  Chat: (p: P) => (
    <Svg {...p}>
      <path d="M12 4.5c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7c-1 0-2-.1-2.9-.4L5 19.6l1.1-3.3C4.5 15 3.5 13.3 3.5 11.5c0-3.9 3.8-7 8.5-7Z" />
    </Svg>
  ),
  ChatFill: (p: P) => (
    <Svg {...p} fill="currentColor">
      <path d="M12 4.5c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7c-1 0-2-.1-2.9-.4L5 19.6l1.1-3.3C4.5 15 3.5 13.3 3.5 11.5c0-3.9 3.8-7 8.5-7Z" />
    </Svg>
  ),
  Sun: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.8v2M12 19.2v2M4.6 4.6 6 6M18 18l1.4 1.4M2.8 12h2M19.2 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </Svg>
  ),
  SunFill: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4.4" fill="currentColor" />
      <path d="M12 2.8v2M12 19.2v2M4.6 4.6 6 6M18 18l1.4 1.4M2.8 12h2M19.2 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </Svg>
  ),
  Target: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.8" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </Svg>
  ),
  TargetFill: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" fill="currentColor" />
      <circle cx="12" cy="12" r="4.8" stroke="var(--bar-bg, #fff)" />
      <circle cx="12" cy="12" r="1.3" fill="var(--bar-bg, #fff)" stroke="none" />
    </Svg>
  ),
  Books: (p: P) => (
    <Svg {...p}>
      <rect x="4" y="4" width="4.4" height="16" rx="1.2" />
      <rect x="9.8" y="4" width="4.4" height="16" rx="1.2" />
      <path d="m16 5.3 3.4-.9 2.6 15-3.4.9z" />
    </Svg>
  ),
  BooksFill: (p: P) => (
    <Svg {...p} fill="currentColor">
      <rect x="4" y="4" width="4.4" height="16" rx="1.2" />
      <rect x="9.8" y="4" width="4.4" height="16" rx="1.2" />
      <path d="m16 5.3 3.4-.9 2.6 15-3.4.9z" />
    </Svg>
  ),
  Menu: (p: P) => (
    <Svg {...p}>
      <path d="M4 7.5h16M4 12h11M4 16.5h16" />
    </Svg>
  ),
  Plus: (p: P) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  Compose: (p: P) => (
    <Svg {...p}>
      <path d="M19 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V7a1.5 1.5 0 0 1 1.5-1.5H11" />
      <path d="m15.5 4.5 4 4L12 16l-4.5 1 1-4.5z" />
    </Svg>
  ),
  Photo: (p: P) => (
    <Svg {...p}>
      <rect x="3.5" y="5" width="17" height="14" rx="3" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m20.5 15.5-4.6-4.4-7.4 7.9" />
    </Svg>
  ),
  ArrowUp: (p: P) => (
    <Svg {...p} strokeWidth={2.4}>
      <path d="M12 19V5.5M6 11l6-6 6 6" />
    </Svg>
  ),
  ArrowDown: (p: P) => (
    <Svg {...p} strokeWidth={2.2}>
      <path d="M12 5v13.5M6 13l6 6 6-6" />
    </Svg>
  ),
  Stop: (p: P) => (
    <Svg {...p} stroke="none" fill="currentColor">
      <rect x="7" y="7" width="10" height="10" rx="2.2" />
    </Svg>
  ),
  Bell: (p: P) => (
    <Svg {...p}>
      <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </Svg>
  ),
  Check: (p: P) => (
    <Svg {...p} strokeWidth={2.4}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  ),
  X: (p: P) => (
    <Svg {...p} strokeWidth={2}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Svg>
  ),
  ChevronRight: (p: P) => (
    <Svg {...p} strokeWidth={2}>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </Svg>
  ),
  ChevronLeft: (p: P) => (
    <Svg {...p} strokeWidth={2.2}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </Svg>
  ),
  ChevronDown: (p: P) => (
    <Svg {...p} strokeWidth={2}>
      <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />
    </Svg>
  ),
  Shield: (p: P) => (
    <Svg {...p}>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </Svg>
  ),
  Sparkle: (p: P) => (
    <Svg {...p}>
      <path d="M12 3.5c.6 4.6 3.9 7.9 8.5 8.5-4.6.6-7.9 3.9-8.5 8.5-.6-4.6-3.9-7.9-8.5-8.5 4.6-.6 7.9-3.9 8.5-8.5Z" />
    </Svg>
  ),
  Trash: (p: P) => (
    <Svg {...p}>
      <path d="M4.5 7h15M10 7V5h4v2M6.5 7l1 12.5h9l1-12.5" />
    </Svg>
  ),
  Play: (p: P) => (
    <Svg {...p} fill="currentColor" stroke="none">
      <path d="M8 5.5v13l11-6.5z" />
    </Svg>
  ),
  Calendar: (p: P) => (
    <Svg {...p}>
      <rect x="4" y="5.5" width="16" height="14.5" rx="3" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </Svg>
  ),
  Mail: (p: P) => (
    <Svg {...p}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.6" />
      <path d="m4.5 7 7.5 6 7.5-6" />
    </Svg>
  ),
  Cloud: (p: P) => (
    <Svg {...p}>
      <path d="M7 18.5a4 4 0 0 1-.6-8 5.5 5.5 0 0 1 10.6-1.3A4.7 4.7 0 0 1 17 18.5z" />
    </Svg>
  ),
  News: (p: P) => (
    <Svg {...p}>
      <rect x="4" y="4.5" width="13" height="15" rx="2" />
      <path d="M17 8.5h2.5V18a1.5 1.5 0 0 1-3 0M7.5 8.5h6M7.5 12h6M7.5 15.5h4" />
    </Svg>
  ),
  Note: (p: P) => (
    <Svg {...p}>
      <path d="M5.5 4.5h13v10l-5 5h-8z" />
      <path d="M13.5 19.5v-5h5M8.5 9h7M8.5 12.5h4" />
    </Svg>
  ),
  File: (p: P) => (
    <Svg {...p}>
      <path d="M6.5 3.5h7l4.5 4.5v12.5h-11.5z" />
      <path d="M13.5 3.5V8H18" />
    </Svg>
  ),
  Doc: (p: P) => (
    <Svg {...p}>
      <path d="M6.5 3.5h7l4.5 4.5v12.5h-11.5z" />
      <path d="M13.5 3.5V8H18M9 12h6M9 15h6M9 18h3.5" />
    </Svg>
  ),
  Table: (p: P) => (
    <Svg {...p}>
      <rect x="4" y="4.5" width="16" height="15" rx="2.4" />
      <path d="M4 9.5h16M4 14.5h16M10 9.5v10" />
    </Svg>
  ),
  Download: (p: P) => (
    <Svg {...p}>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
    </Svg>
  ),
  Gear: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
    </Svg>
  ),
  Link: (p: P) => (
    <Svg {...p}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 1 0 13 5.3l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 1 0 11 18.7l1-1" />
    </Svg>
  ),
  Reply: (p: P) => (
    <Svg {...p}>
      <path d="M9.5 6.5 4 12l5.5 5.5" />
      <path d="M4.5 12h9a6 6 0 0 1 6 6v1" />
    </Svg>
  ),
  Copy: (p: P) => (
    <Svg {...p}>
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Svg>
  ),
  Search: (p: P) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6" />
      <path d="m19.5 19.5-4-4" />
    </Svg>
  ),
  Clock: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  ),
  Pause: (p: P) => (
    <Svg {...p} fill="currentColor" stroke="none">
      <rect x="6.5" y="5.5" width="4" height="13" rx="1.2" />
      <rect x="13.5" y="5.5" width="4" height="13" rx="1.2" />
    </Svg>
  ),
  Heart: (p: P) => (
    <Svg {...p}>
      <path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10Z" />
    </Svg>
  ),
  Wallet: (p: P) => (
    <Svg {...p}>
      <rect x="3.5" y="6" width="17" height="13" rx="2.6" />
      <path d="M16 12.5h4.5M3.5 9.5h17M6 6l9-2.5L16 6" />
    </Svg>
  ),
  Briefcase: (p: P) => (
    <Svg {...p}>
      <rect x="3.5" y="7" width="17" height="12.5" rx="2.4" />
      <path d="M9 7V5.5h6V7M3.5 12.5h17" />
    </Svg>
  ),
  People: (p: P) => (
    <Svg {...p}>
      <circle cx="9" cy="9" r="3" />
      <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
      <circle cx="16.5" cy="9.5" r="2.4" />
      <path d="M16 14.6c2.4 0 4 1.3 4.5 3.9" />
    </Svg>
  ),
  Bolt: (p: P) => (
    <Svg {...p}>
      <path d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12z" />
    </Svg>
  ),
  Grad: (p: P) => (
    <Svg {...p}>
      <path d="m12 5 9.5 4.5L12 14 2.5 9.5z" />
      <path d="M6.5 11.5V16c1.5 1.5 3.5 2.2 5.5 2.2s4-.7 5.5-2.2v-4.5M21.5 9.5V15" />
    </Svg>
  ),
  Home: (p: P) => (
    <Svg {...p}>
      <path d="M4 11 12 4.5l8 6.5v8.5a1 1 0 0 1-1 1h-4.5V15h-5v5.5H5a1 1 0 0 1-1-1z" />
    </Svg>
  ),
  Dots: (p: P) => (
    <Svg {...p} fill="currentColor" stroke="none">
      <circle cx="6" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18" cy="12" r="1.7" />
    </Svg>
  ),
  Brain: (p: P) => (
    <Svg {...p}>
      <path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 .5V6.5a2.5 2.5 0 0 0-3-2Z" />
      <path d="M15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 .5" />
    </Svg>
  ),
  Smile: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14a4.2 4.2 0 0 0 7 0" />
      <circle cx="9" cy="10" r=".6" fill="currentColor" />
      <circle cx="15" cy="10" r=".6" fill="currentColor" />
    </Svg>
  ),
  Lock: (p: P) => (
    <Svg {...p}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.4" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Svg>
  ),
  Moon: (p: P) => (
    <Svg {...p}>
      <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />
    </Svg>
  ),
};

export type IconName = keyof typeof I;
