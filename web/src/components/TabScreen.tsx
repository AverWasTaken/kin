import { useState, type ReactNode } from "react";

/** iOS-style large title that hands off to a compact blurred bar once you scroll. */
export function TabScreen({ eyebrow, title, children, after }: { eyebrow: ReactNode; title: string; children: ReactNode; after?: ReactNode }) {
  const [scroll, setScroll] = useState(0);
  return (
    <div className="screen">
      <div className={`compact-bar ${scroll > 4 ? "solid" : ""} ${scroll > 52 ? "titled" : ""}`} aria-hidden="true">
        <span>{title}</span>
      </div>
      <div className="scroll tab-pad" onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
        <header className="large-head">
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
        </header>
        {children}
      </div>
      {after}
    </div>
  );
}
