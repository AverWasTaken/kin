import { useEffect, useState } from "react";
import { api } from "../lib/client";
import type { MemoryName } from "../lib/api";
import { toast } from "../lib/store";
import { useLastDefined } from "../lib/hooks";
import { Sheet } from "../components/Sheet";

const TITLES: Record<MemoryName, { title: string; hint: string }> = {
  soul: { title: "Soul", hint: "How your agent thinks and talks. It reads this before every conversation." },
  identity: { title: "About you", hint: "What your agent knows about you. Fix anything that's wrong." },
  memory: { title: "Memory", hint: "Notes your agent keeps over time. It tidies these up on its own." },
};

export function MemoryEditor({ name: current, onClose }: { name: MemoryName | null; onClose: () => void }) {
  const name = useLastDefined(current);
  const [text, setText] = useState<string | null>(null);
  const [orig, setOrig] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!current) return;
    setText(null);
    api
      .memory()
      .then((m) => {
        setText(m[current]);
        setOrig(m[current]);
      })
      .catch(() => {
        toast("Couldn't load memory");
        onClose();
      });
  }, [current, onClose]);

  const dirty = text != null && text !== orig;
  const save = async () => {
    if (!name || text == null) return;
    setSaving(true);
    try {
      await api.putMemory(name, text);
      setOrig(text);
      toast("Saved");
      onClose();
    } catch {
      toast("Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const meta = name ? TITLES[name] : null;
  return (
    <Sheet
      open={!!current}
      onClose={onClose}
      size="full"
      title={meta?.title}
      left={
        <button type="button" className="btn btn-plain" onClick={onClose}>
          Cancel
        </button>
      }
      right={
        <button type="button" className="btn btn-plain strong" disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
      }
    >
      <div className="mem-editor">
        <p className="mem-hint">{meta?.hint}</p>
        {text == null ? (
          <div className="viewer-loading">
            <span className="spinner" />
          </div>
        ) : (
          <textarea className="mem-text" value={text} onChange={(e) => setText(e.target.value)} spellCheck aria-label={meta?.title} />
        )}
      </div>
    </Sheet>
  );
}
