import { motion } from "motion/react";
import type { AvatarConfig } from "@shared/api";
import { AVATAR_ACCESSORIES, AVATAR_COLORS, AVATAR_EYES, AVATAR_SHAPES, Avatar } from "./Avatar";

const LABEL: Record<string, string> = {
  none: "None",
  beret: "Beret",
  glasses: "Glasses",
  bowtie: "Bow tie",
  monocle: "Monocle",
  headphones: "Headphones",
  flower: "Flower",
  dot: "Dots",
  diamond: "Gems",
  happy: "Happy",
  sleepy: "Sleepy",
  bean: "Bean",
  cloud: "Cloud",
  blob: "Blob",
  ghost: "Ghost",
  cat: "Cat",
  star: "Star",
};

function Option({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`cz-opt ${on ? "on" : ""}`} aria-pressed={on} aria-label={label} onClick={onClick}>
      {on && <motion.span className="cz-ring" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} />}
      {children}
      <span className="cz-label">{label}</span>
    </button>
  );
}

export function AvatarCustomizer({ value, onChange }: { value: AvatarConfig; onChange: (v: AvatarConfig) => void }) {
  const set = (patch: Partial<AvatarConfig>) => onChange({ ...value, ...patch });
  return (
    <div className="cz">
      <section>
        <h3 className="cz-title">Shape</h3>
        <div className="cz-grid">
          {AVATAR_SHAPES.map((s) => (
            <Option key={s} on={value.shape === s} label={LABEL[s]} onClick={() => set({ shape: s })}>
              <Avatar config={{ ...value, shape: s, accessory: "none" }} size={46} />
            </Option>
          ))}
        </div>
      </section>
      <section>
        <h3 className="cz-title">Color</h3>
        <div className="cz-swatches" role="group" aria-label="Color">
          {AVATAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`cz-swatch ${value.color.toLowerCase() === c.toLowerCase() ? "on" : ""}`}
              style={{ background: c }}
              aria-label={`Color ${c}`}
              aria-pressed={value.color.toLowerCase() === c.toLowerCase()}
              onClick={() => set({ color: c })}
            />
          ))}
        </div>
      </section>
      <section>
        <h3 className="cz-title">Eyes</h3>
        <div className="cz-grid cz-grid-4">
          {AVATAR_EYES.map((e) => (
            <Option key={e} on={value.eyes === e} label={LABEL[e]} onClick={() => set({ eyes: e })}>
              <Avatar config={{ ...value, eyes: e, accessory: "none" }} size={46} />
            </Option>
          ))}
        </div>
      </section>
      <section>
        <h3 className="cz-title">Accessory</h3>
        <div className="cz-grid cz-grid-4">
          {AVATAR_ACCESSORIES.map((a) => (
            <Option key={a} on={value.accessory === a} label={LABEL[a]} onClick={() => set({ accessory: a })}>
              <Avatar config={{ ...value, accessory: a }} size={46} />
            </Option>
          ))}
        </div>
      </section>
    </div>
  );
}
