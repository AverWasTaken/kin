import type { Attachment, Message, OnboardingInput } from "@shared/api";
import { ApiError, type ApprovalDecision } from "./api";
import { api, stream } from "./client";
import { setLastSeq } from "./stream";
import {
  aliasMessage,
  applyBootstrap,
  applyEvent,
  getKin,
  isBusy,
  patchMessage,
  setKin,
  setMessages,
  toast,
  type Tab,
} from "./store";
import { applyAccent } from "./color";

const PAGE = 40;
let disconnect: (() => void) | null = null;

export async function boot(opts: { quiet?: boolean } = {}) {
  // A quiet boot keeps the current screen up (e.g. sign-in) instead of flashing the splash.
  if (!opts.quiet) setKin({ phase: "boot" });
  setKin({ bootError: null });
  try {
    const b = await api.bootstrap();
    setLastSeq(b.seq);
    applyBootstrap(b);
    applyAccent(b.agent.avatar.color);
    connect();
    const tid = getKin().activeThreadId;
    if (tid) await loadThread(tid);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) setKin({ phase: "signin" });
    else setKin({ phase: "error", bootError: err instanceof Error ? err.message : String(err) });
  }
}

function connect() {
  disconnect?.();
  disconnect = stream.connect(
    (e) => {
      applyEvent(e);
      if (e.type === "message.created" && e.data?.role === "agent") markSeenIfVisible(e.data.threadId);
    },
    (s) => setKin({ streamStatus: s }),
    () => {
      resync().catch(() => setTimeout(() => resync().catch(() => {}), 3000));
    },
  );
}

/** The server dropped our cursor: start over from a fresh snapshot. */
async function resync() {
  disconnect?.();
  disconnect = null;
  setKin({ streamStatus: "connecting" });
  const b = await api.bootstrap();
  setLastSeq(b.seq);
  applyBootstrap(b);
  // Other threads reload when opened; the open one reloads now.
  setKin({ messages: {}, hasMore: {} });
  const tid = getKin().activeThreadId;
  if (tid) {
    const list = await api.messages(tid, { limit: PAGE });
    setMessages(tid, list, list.length >= PAGE, false, true);
  }
  connect();
}

export async function signIn(token: string) {
  await api.login(token.trim());
  await boot({ quiet: true });
}

export async function finishOnboarding(input: OnboardingInput) {
  const b = await api.onboarding(input);
  setLastSeq(b.seq);
  applyBootstrap(b);
  applyAccent(b.agent.avatar.color);
  setKin({ phase: "app", tab: "chat" });
  connect();
  const tid = getKin().activeThreadId;
  if (tid) await loadThread(tid);
}

export async function loadThread(threadId: string) {
  const list = await api.messages(threadId, { limit: PAGE });
  setMessages(threadId, list, list.length >= PAGE);
  markSeenIfVisible(threadId);
}

export async function loadOlder(threadId: string) {
  const list = getKin().messages[threadId];
  if (!list?.length || !getKin().hasMore[threadId]) return;
  const older = await api.messages(threadId, { before: list[0].createdAt, limit: PAGE });
  setMessages(threadId, older, older.length >= PAGE, true);
}

export function markSeenIfVisible(threadId: string) {
  const s = getKin();
  if (document.visibilityState !== "visible" || s.tab !== "chat" || s.activeThreadId !== threadId) return;
  const t = s.threads.find((x) => x.id === threadId);
  if (t && t.unread > 0) {
    setKin({ threads: s.threads.map((x) => (x.id === threadId ? { ...x, unread: 0 } : x)) });
  }
  api.seen(threadId).catch(() => {});
  navigator.clearAppBadge?.().catch(() => {});
}

export function setTab(tab: Tab) {
  setKin({ tab });
  if (tab === "chat") markSeenIfVisible(getKin().activeThreadId);
}

export async function openThread(threadId: string) {
  setKin({ activeThreadId: threadId, tab: "chat" });
  if (!getKin().messages[threadId]) await loadThread(threadId);
  else markSeenIfVisible(threadId);
}

export async function newThread() {
  const t = await api.createThread("New chat");
  setKin({ threads: [...getKin().threads.filter((x) => x.id !== t.id), t] });
  setMessages(t.id, [], false);
  await openThread(t.id);
}

export async function sendMessage(text: string, opts: { replyTo?: string; attachments?: Attachment[] } = {}) {
  const s = getKin();
  const threadId = s.activeThreadId;
  const busy = isBusy(s.agentState[threadId]?.state);
  const local: Message = {
    id: `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    threadId,
    role: "user",
    kind: "text",
    text,
    createdAt: Date.now(),
    status: busy ? "queued" : "sent",
    replyTo: opts.replyTo,
    attachments: opts.attachments,
    reactions: [],
    source: "chat",
  };
  setKin({ messages: { ...s.messages, [threadId]: [...(s.messages[threadId] ?? []), local] } });
  try {
    const m = await api.send(threadId, {
      text,
      replyTo: opts.replyTo,
      attachments: opts.attachments?.map((a) => a.id),
      clientId: local.id,
    });
    aliasMessage(m.id, local.id);
    const list = getKin().messages[threadId] ?? [];
    const has = list.some((x) => x.id === m.id);
    setKin({
      messages: {
        ...getKin().messages,
        [threadId]: has
          ? list.filter((x) => x.id !== local.id)
          : list.map((x) => (x.id === local.id ? { ...m, status: m.status ?? x.status } : x)),
      },
    });
  } catch (err) {
    patchMessage(threadId, local.id, (m) => ({ ...m, status: undefined }));
    toast(err instanceof Error ? `Couldn't send: ${err.message}` : "Couldn't send");
  }
}

export async function stopAgent() {
  const tid = getKin().activeThreadId;
  try {
    await api.stop(tid);
  } catch {
    toast("Couldn't stop the agent");
  }
}

export async function toggleReaction(m: Message, emoji: string) {
  const mine = m.reactions.find((r) => r.by === "user");
  const others = m.reactions.filter((r) => r.by !== "user");
  const next = mine?.emoji === emoji ? others : [...others, { emoji, by: "user" as const }];
  patchMessage(m.threadId, m.id, (x) => ({ ...x, reactions: next }));
  if (m.id.startsWith("local-")) return;
  try {
    await api.react(m.id, emoji);
  } catch {
    patchMessage(m.threadId, m.id, (x) => ({ ...x, reactions: m.reactions }));
    toast("Couldn't react");
  }
}

export async function decideApproval(m: Message, decision: ApprovalDecision) {
  if (!m.approval) return;
  const status = decision === "once" ? "allowed" : decision === "always" ? "always" : "denied";
  applyEvent({ seq: 0, type: "approval.resolved", data: { approvalId: m.approval.approvalId, status } });
  try {
    await api.approve(m.approval.approvalId, decision);
  } catch (err) {
    applyEvent({ seq: 0, type: "message.updated", data: m });
    toast(err instanceof Error ? err.message : "Couldn't send decision");
  }
}

let typingTimer: ReturnType<typeof setTimeout> | undefined;
let typingOn = false;

/** Tells the agent we're typing; flips off after a pause. */
export function noteTyping(hasText: boolean) {
  const tid = getKin().activeThreadId;
  setKin({ userTyping: hasText });
  clearTimeout(typingTimer);
  if (hasText && !typingOn) {
    typingOn = true;
    api.typing(tid, true).catch(() => {});
  }
  typingTimer = setTimeout(
    () => {
      if (!typingOn) return;
      typingOn = false;
      setKin({ userTyping: false });
      api.typing(tid, false).catch(() => {});
    },
    hasText ? 4000 : 0,
  );
}

/** Hands a prompt to the agent in the main chat and shows it. */
export async function askAgent(prompt: string) {
  const s = getKin();
  const main = s.threads.find((t) => t.main)?.id ?? s.activeThreadId;
  await openThread(main);
  setTab("chat");
  await sendMessage(prompt);
}

export async function doIdea(id: string) {
  const s = getKin();
  const main = s.threads.find((t) => t.main)?.id ?? s.activeThreadId;
  await openThread(main);
  try {
    const m = await api.doIdea(id);
    applyEvent({ seq: 0, type: "message.created", data: m });
  } catch {
    toast("Couldn't start that idea");
  }
}
