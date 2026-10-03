import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import { getKin, setKin } from "../lib/store";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  size?: "large" | "auto" | "full";
  className?: string;
  label?: string;
}

function DepthCounter() {
  useEffect(() => {
    setKin({ sheetDepth: getKin().sheetDepth + 1 });
    return () => setKin({ sheetDepth: Math.max(0, getKin().sheetDepth - 1) });
  }, []);
  return null;
}

export function Sheet({ open, onClose, children, title, left, right, size = "large", className, label }: SheetProps) {
  const controls = useDragControls();
  const root = document.getElementById("sheet-root");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const content = (
    <AnimatePresence>
      {open && (
        <div className="sheet-layer" key="sheet">
          <DepthCounter />
          <motion.div
            className="sheet-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label ?? (typeof title === "string" ? title : undefined)}
            className={`sheet sheet-${size} ${className ?? ""}`}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 36, mass: 0.9 }}
            drag="y"
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.04, bottom: 0.85 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 650) onClose();
            }}
          >
            <div className="sheet-head" onPointerDown={(e) => controls.start(e)}>
              <div className="grabber" />
              {(title || left || right) && (
                <div className="sheet-bar">
                  <div className="sheet-side">{left}</div>
                  <div className="sheet-title">{title}</div>
                  <div className="sheet-side right">{right}</div>
                </div>
              )}
            </div>
            <div className="sheet-body scroll">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
  return root ? createPortal(content, root) : content;
}
