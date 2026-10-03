import type { AgentState, AvatarConfig } from "@shared/api";
import { AVATAR_ACCESSORIES, AVATAR_COLORS, AVATAR_SHAPES, Avatar } from "../components/Avatar";

const STATES: AgentState[] = ["idle", "listening", "reading", "thinking", "typing", "working", "done", "asleep"];

/** Dev-only sheet of every shape, accessory and state. Open with ?gallery=1 in dev. */
export function AvatarGallery() {
  return (
    <div className="gallery">
      {AVATAR_SHAPES.map((shape, i) => (
        <div key={shape} className="gallery-row">
          {AVATAR_ACCESSORIES.map((accessory, j) => {
            const config: AvatarConfig = {
              shape,
              accessory,
              color: AVATAR_COLORS[(i + j) % AVATAR_COLORS.length],
              eyes: (["dot", "diamond", "happy", "sleepy"] as const)[j % 4],
            };
            return <Avatar key={accessory} config={config} size={64} state={STATES[(i + j) % STATES.length]} />;
          })}
        </div>
      ))}
      <div className="gallery-row">
        {STATES.map((s) => (
          <figure key={s}>
            <Avatar config={{ shape: "bean", color: "#57C4A4", accessory: "none", eyes: "dot" }} size={72} state={s} />
            <figcaption>{s}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
