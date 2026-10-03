import { memo } from "react";

/**
 * iMessage's three dots in a gray bubble with its two trailing circles. No text: the header
 * already says what the agent is doing. "thinking" breathes slower than "typing".
 */
export const TypingIndicator = memo(function TypingIndicator({ variant }: { variant: "typing" | "thinking" }) {
  return (
    <div className={`typing-row ${variant}`} role="status" aria-label={variant === "typing" ? "Typing" : "Thinking"}>
      <div className="typing-bubble">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
});
