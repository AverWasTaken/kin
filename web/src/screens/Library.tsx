import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import type { LibraryItem } from "@shared/api";
import { api } from "../lib/client";
import { useKin } from "../lib/store";
import { useResource } from "../lib/useResource";
import { useLastDefined } from "../lib/hooks";
import { bytes, shortDate } from "../lib/time";
import { I, type IconName } from "../components/Icons";
import { Sheet } from "../components/Sheet";
import { Markdown } from "../components/Markdown";
import { Segmented } from "../components/Controls";
import { TabScreen } from "../components/TabScreen";

type Kind = "image" | "doc" | "data" | "pdf" | "other";

function kindOf(mime: string): Kind {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/csv" || mime.includes("json") || mime.includes("spreadsheet")) return "data";
  if (mime.startsWith("text/")) return "doc";
  return "other";
}

const KIND: Record<Kind, { icon: IconName; color: string; label: string }> = {
  image: { icon: "Photo", color: "#4BA8DE", label: "Image" },
  doc: { icon: "Doc", color: "#C8743A", label: "Note" },
  data: { icon: "Table", color: "#2A9A68", label: "Data" },
  pdf: { icon: "File", color: "#E0533D", label: "PDF" },
  other: { icon: "File", color: "#8A8378", label: "File" },
};

function ext(path: string) {
  return path.split(".").pop()?.toUpperCase() ?? "";
}

function Tile({ item, onOpen }: { item: LibraryItem; onOpen: () => void }) {
  const k = kindOf(item.mime);
  const meta = KIND[k];
  const Icon = I[meta.icon];
  const src = k === "image" ? item.url || api.libraryRawUrl(item.path) : null;
  return (
    <motion.button type="button" className="tile" onClick={onOpen} whileTap={{ scale: 0.97 }} layout>
      <span className={`tile-art kind-${k}`} style={{ "--k": meta.color } as React.CSSProperties}>
        {src ? (
          <img src={src} alt="" loading="lazy" />
        ) : (
          <>
            <Icon size={30} />
            <span className="tile-ext">{ext(item.path)}</span>
          </>
        )}
      </span>
      <span className="tile-title">{item.title}</span>
      <span className="tile-meta">
        {shortDate(item.createdAt)} · {bytes(item.size)}
      </span>
    </motion.button>
  );
}

function CsvTable({ text }: { text: string }) {
  const rows = text.trim().split("\n").map((r) => r.split(","));
  return (
    <div className="md">
      <div className="md-table">
        <table>
          <thead>
            <tr>{rows[0]?.map((c, i) => <th key={i}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(1).map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Viewer({ item: current, onClose }: { item: LibraryItem | null; onClose: () => void }) {
  const item = useLastDefined(current);
  const [text, setText] = useState<string | null>(null);
  const k = item ? kindOf(item.mime) : "other";

  useEffect(() => {
    setText(null);
    if (!current || (k !== "doc" && k !== "data")) return;
    let live = true;
    api
      .libraryText(current.path)
      .then((t) => live && setText(t))
      .catch(() => live && setText(""));
    return () => {
      live = false;
    };
  }, [current, k]);

  const raw = item ? api.libraryRawUrl(item.path) : "#";

  return (
    <Sheet
      open={!!current}
      onClose={onClose}
      title={item?.title}
      right={
        <a className="icon-btn" href={raw} download={item?.path.split("/").pop()} aria-label="Download">
          <I.Download size={21} />
        </a>
      }
    >
      {item && (
        <div className="viewer">
          {k === "image" && <img className="viewer-img" src={item.url || raw} alt={item.title} />}
          {k === "doc" && (text == null ? <div className="viewer-loading"><span className="spinner" /></div> : item.mime === "text/markdown" ? <Markdown text={text} className="doc" /> : <pre className="viewer-pre">{text}</pre>)}
          {k === "data" && (text == null ? <div className="viewer-loading"><span className="spinner" /></div> : item.mime === "text/csv" ? <CsvTable text={text} /> : <pre className="viewer-pre">{text}</pre>)}
          {(k === "pdf" || k === "other") && (
            <div className="empty">
              <span className="viewer-file" style={{ "--k": KIND[k].color } as React.CSSProperties}>
                <I.File size={40} />
                <b>{ext(item.path)}</b>
              </span>
              <h3>{item.title}</h3>
              <p>
                {bytes(item.size)} · saved {shortDate(item.createdAt)}
              </p>
              <a className="btn btn-primary" style={{ marginTop: 18 }} href={raw} target="_blank" rel="noreferrer">
                <I.Download size={18} /> Open file
              </a>
            </div>
          )}
          <p className="viewer-path">{item.path}</p>
        </div>
      )}
    </Sheet>
  );
}

type Filter = "all" | "docs" | "images" | "files";

export function Library() {
  const version = useKin((s) => s.versions.library);
  const agentName = useKin((s) => s.agent.name);
  const { data } = useResource(() => api.library(), version);
  const [open, setOpen] = useState<LibraryItem | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const items = useMemo(() => {
    const list = [...(data ?? [])].sort((a, b) => b.createdAt - a.createdAt);
    return list.filter((i) => {
      const k = kindOf(i.mime);
      if (filter === "docs") return k === "doc" || k === "data";
      if (filter === "images") return k === "image";
      if (filter === "files") return k === "pdf" || k === "other";
      return true;
    });
  }, [data, filter]);

  return (
    <TabScreen eyebrow={data ? `${data.length} saved by ${agentName}` : " "} title="Library" after={<Viewer item={open} onClose={() => setOpen(null)} />}>
        <div className="lib-filter">
          <Segmented<Filter>
            label="Filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "docs", label: "Notes" },
              { value: "images", label: "Images" },
              { value: "files", label: "Files" },
            ]}
          />
        </div>
        {data && items.length === 0 && (
          <div className="empty">
            <h3>Nothing here yet</h3>
            <p>When {agentName} researches something or makes a file for you, it lands here.</p>
          </div>
        )}
        <div className="tiles">
          {items.map((i) => (
            <Tile key={i.path} item={i} onOpen={() => setOpen(i)} />
          ))}
        </div>
    </TabScreen>
  );
}
