import { create } from "zustand";
import type {
  AgentInfo,
  AgentState,
  ApprovalMeta,
  Bootstrap,
  Connection,
  Message,
  Run,
  Settings,
  StreamEvent,
  Thread,
  Usage,
} from "@shared/api";
import type { StreamStatus } from "./api";

export type Tab = "chat" | "today" | "goals" | "library";
export type Phase = "boot" | "signin" | "onboarding" | "app" | "error";

export interface ThreadState {
  state: AgentState;
  status: string;
  /** Set when an agent message arrived after the last state change: hides the typing bubble. */
  answered: boolean;
}

export const DEFAULT_AGENT: AgentInfo = {
  name: "Kin",
  tagline: "",
  avatar: { shape: "bean", color: "#57C4A4", accessory: "none", eyes: "dot" },
};

export interface KinState {
  phase: Phase;
  bootError: string | null;
  onboarded: boolean;
  agent: AgentInfo;
  settings: Settings | null;
  connections: Connection[];
  vapidPublicKey: string;

  threads: Thread[];
  activeThreadId: string;
  messages: Record<string, Message[]>;
  hasMore: Record<string, boolean>;
  agentState: Record<string, ThreadState>;
  pendingApprovals: Message[];
  runs: Record<string, Run>;
  usage: Usage | null;
  versions: { today: number; goals: number; schedules: number; library: number; runs: number };

  tab: Tab;
  streamStatus: StreamStatus;
  sheetDepth: number;
  userTyping: boolean;
  keyboardOpen: boolean;
  /** The chat composer holds a draft: the tab bar steps aside until it's sent. */
  composing: boolean;
  toast: { id: number; text: string } | null;
  profileOpen: boolean;
  runDetail: string | null;
}

export const useKin = create<KinState>(() => ({
  phase: "boot",
  bootError: null,
  onboarded: true,
  agent: DEFAULT_AGENT,
  settings: null,
  connections: [],
  vapidPublicKey: "",
  threads: [],
  activeThreadId: "",
  messages: {},
  hasMore: {},
  agentState: {},
  pendingApprovals: [],
  runs: {},
  usage: null,
  versions: { today: 0, goals: 0, schedules: 0, library: 0, runs: 0 },
  tab: "chat",
  streamStatus: "connecting",
  sheetDepth: 0,
  userTyping: false,
  keyboardOpen: false,
  composing: false,
  toast: null,
  profileOpen: false,
  runDetail: null,
}));

export const getKin = useKin.getState;
export const setKin = useKin.setState;

// Entrance delays for staggered agent bubbles. Read once when a bubble mounts, so it lives
// outside the store: writing it there would re-render the whole list for nothing.
const lastReveal: Record<string, number> = {};
const revealDelays = new Map<string, number>();

export function revealDelay(id: string) {
  return revealDelays.get(id) ?? 0;
}

// Server id -> the optimistic id it replaced. Rows key on the first id a message had, so the
// swap from "local-…" to the real message updates the bubble in place instead of remounting
// it (which replayed the entrance animation and dropped the receipt crossfade).
const renderKeys = new Map<string, string>();

export function renderKey(id: string) {
  return renderKeys.get(id) ?? id;
}

export function aliasMessage(serverId: string, localId: string) {
  if (serverId !== localId) renderKeys.set(serverId, renderKey(localId));
}

export function isLocalId(id: string) {
  return id.startsWith("local-");
}

function sortMessages(list: Message[]) {
  return list.sort((a, b) => a.createdAt - b.createdAt);
}

/** Inserts or replaces a message, resolving optimistic copies of the user's own sends. */
function upsertMessage(list: Message[] | undefined, m: Message): Message[] {
  const out = list ? [...list] : [];
  const i = out.findIndex((x) => x.id === m.id);
  if (i >= 0) {
    out[i] = { ...out[i], ...m };
    return out;
  }
  if (m.role === "user") {
    // Prefer the echoed clientId; fall back to matching text for servers that don't echo it.
    let j = m.clientId ? out.findIndex((x) => x.id === m.clientId) : -1;
    if (j < 0) j = out.findIndex((x) => isLocalId(x.id) && x.text === m.text);
    if (j >= 0) {
      aliasMessage(m.id, out[j].id);
      out[j] = m;
      return sortMessages(out);
    }
  }
  out.push(m);
  return sortMessages(out);
}

function withApproval(list: Message[], approvalId: string, status: ApprovalMeta["status"]) {
  let changed = false;
  const out = list.map((m) => {
    if (m.approval?.approvalId !== approvalId) return m;
    changed = true;
    return { ...m, approval: { ...m.approval, status } };
  });
  return changed ? out : list;
}

function syncPending(pending: Message[], m: Message): Message[] {
  if (m.kind !== "approval" || !m.approval) return pending;
  const rest = pending.filter((p) => p.id !== m.id);
  return m.approval.status === "pending" ? [...rest, m] : rest;
}

export function applyBootstrap(b: Bootstrap) {
  const agentState: Record<string, ThreadState> = {};
  for (const [id, s] of Object.entries(b.state ?? {})) if (s?.state) agentState[id] = { ...s, answered: false };
  const main = b.threads.find((t) => t.main) ?? b.threads[0];
  const prev = getKin().activeThreadId;
  setKin({
    onboarded: b.onboarded,
    agent: b.agent,
    settings: b.settings,
    connections: b.connections,
    vapidPublicKey: b.vapidPublicKey,
    threads: b.threads,
    activeThreadId: b.threads.some((t) => t.id === prev) ? prev : (main?.id ?? ""),
    agentState,
    pendingApprovals: (b.pendingApprovals ?? []).filter((m) => m?.approval),
    phase: b.onboarded ? "app" : "onboarding",
  });
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const isStr = (v: unknown) => typeof v === "string" && v.length > 0;

/**
 * Rejects events whose payload is missing or malformed. Old stored events can replay
 * with null data on reconnect; those are dropped instead of throwing.
 */
function isValidEvent(e: unknown): e is StreamEvent {
  if (!isObj(e) || typeof e.type !== "string") return false;
  const d = e.data;
  switch (e.type) {
    case "message.created":
    case "message.updated":
      return isObj(d) && isStr(d.id) && isStr(d.threadId);
    case "message.status":
      return isObj(d) && isStr(d.threadId) && Array.isArray(d.ids);
    case "reaction":
      return isObj(d) && isStr(d.messageId) && isStr(d.threadId) && Array.isArray(d.reactions);
    case "agent.state":
      return isObj(d) && isStr(d.threadId) && isStr(d.state);
    case "thread.updated":
    case "thread.deleted":
    case "run.updated":
      return isObj(d) && isStr(d.id);
    case "approval.resolved":
      return isObj(d) && isStr(d.approvalId) && isStr(d.status);
    case "usage.updated":
      return isObj(d);
    // Pure "refetch" signals carry no payload worth checking.
    case "today.updated":
    case "goals.updated":
    case "schedules.updated":
    case "library.updated":
      return true;
    default:
      return false;
  }
}

/** Fills fields the UI relies on, so a sparse message from the server can't crash a render. */
function normalizeMessage(m: Message): Message {
  return { ...m, kind: m.kind ?? "text", text: m.text ?? "", reactions: Array.isArray(m.reactions) ? m.reactions : [] };
}

export function applyEvent(e: StreamEvent) {
  if (!isValidEvent(e)) return;
  const s = getKin();
  switch (e.type) {
    case "message.created":
    case "message.updated": {
      const m = normalizeMessage(e.data);
      const patch: Partial<KinState> = {
        messages: { ...s.messages, [m.threadId]: upsertMessage(s.messages[m.threadId], m) },
        pendingApprovals: syncPending(s.pendingApprovals, m),
      };
      if (e.type === "message.created" && m.role === "agent") {
        const ts = s.agentState[m.threadId];
        if (ts && !ts.answered) patch.agentState = { ...s.agentState, [m.threadId]: { ...ts, answered: true } };
        const now = performance.now();
        const at = Math.max(now, (lastReveal[m.threadId] ?? 0) + 380);
        lastReveal[m.threadId] = at;
        revealDelays.set(m.id, (at - now) / 1000);
      }
      setKin(patch);
      break;
    }
    case "message.status": {
      const { threadId, ids, status, at } = e.data;
      const list = s.messages[threadId];
      if (!list) break;
      const set = new Set(ids);
      setKin({
        messages: {
          ...s.messages,
          [threadId]: list.map((m) =>
            set.has(m.id) ? { ...m, status, readAt: status === "read" ? at : m.readAt } : m,
          ),
        },
      });
      break;
    }
    case "reaction": {
      const { messageId, threadId, reactions } = e.data;
      const list = s.messages[threadId];
      if (!list) break;
      setKin({
        messages: {
          ...s.messages,
          [threadId]: list.map((m) => (m.id === messageId ? { ...m, reactions } : m)),
        },
      });
      break;
    }
    case "agent.state": {
      const { threadId, state } = e.data;
      const status = e.data.status ?? "";
      const prev = s.agentState[threadId];
      if (prev && prev.state === state && prev.status === status && !prev.answered) break; // nothing changed
      // Every state change re-arms the typing indicator.
      setKin({ agentState: { ...s.agentState, [threadId]: { state, status, answered: false } } });
      break;
    }
    case "thread.updated": {
      const t = e.data;
      const exists = s.threads.some((x) => x.id === t.id);
      const threads = exists ? s.threads.map((x) => (x.id === t.id ? t : x)) : [...s.threads, t];
      setKin({ threads });
      break;
    }
    case "thread.deleted": {
      const threads = s.threads.filter((t) => t.id !== e.data.id);
      const active =
        s.activeThreadId === e.data.id ? (threads.find((t) => t.main)?.id ?? threads[0]?.id ?? "") : s.activeThreadId;
      setKin({ threads, activeThreadId: active });
      break;
    }
    case "run.updated": {
      const run = e.data;
      // Keep task cards in step with their run even if the server only sends run updates.
      const messages = { ...s.messages };
      for (const [tid, list] of Object.entries(messages)) {
        if (!list.some((m) => m.task?.runId === run.id)) continue;
        messages[tid] = list.map((m) =>
          m.task?.runId === run.id ? { ...m, task: { ...m.task, status: run.status } } : m,
        );
      }
      setKin({
        runs: { ...s.runs, [run.id]: run },
        messages,
        versions: { ...s.versions, runs: s.versions.runs + 1 },
      });
      break;
    }
    case "approval.resolved": {
      const { approvalId, status } = e.data;
      const messages: Record<string, Message[]> = {};
      for (const [tid, list] of Object.entries(s.messages)) messages[tid] = withApproval(list, approvalId, status);
      setKin({
        messages,
        pendingApprovals: s.pendingApprovals.filter((m) => m.approval?.approvalId !== approvalId),
      });
      break;
    }
    case "today.updated":
    case "goals.updated":
    case "schedules.updated":
    case "library.updated": {
      const key = e.type.split(".")[0] as "today" | "goals" | "schedules" | "library";
      setKin({ versions: { ...s.versions, [key]: s.versions[key] + 1 } });
      break;
    }
    case "usage.updated":
      setKin({ usage: e.data });
      break;
  }
}

export function setMessages(threadId: string, list: Message[], hasMore: boolean, prepend = false, replace = false) {
  const s = getKin();
  const existing = replace ? [] : (s.messages[threadId] ?? []);
  const byId = new Map<string, Message>();
  for (const m of prepend ? [...list, ...existing] : [...existing, ...list]) if (m?.id) byId.set(m.id, normalizeMessage(m));
  setKin({
    messages: { ...s.messages, [threadId]: sortMessages([...byId.values()]) },
    hasMore: { ...s.hasMore, [threadId]: hasMore },
  });
}

export function patchMessage(threadId: string, id: string, fn: (m: Message) => Message) {
  const s = getKin();
  const list = s.messages[threadId];
  if (!list) return;
  setKin({ messages: { ...s.messages, [threadId]: list.map((m) => (m.id === id ? fn(m) : m)) } });
}

let toastId = 0;
export function toast(text: string) {
  const id = ++toastId;
  setKin({ toast: { id, text } });
  setTimeout(() => {
    if (getKin().toast?.id === id) setKin({ toast: null });
  }, 2600);
}

export function isBusy(state: AgentState | undefined) {
  return state === "reading" || state === "thinking" || state === "typing" || state === "working";
}
