import type {
  AgentInfo,
  Attachment,
  Bootstrap,
  Goal,
  LibraryItem,
  MemoryFiles,
  Message,
  OnboardingInput,
  Run,
  RunLogEntry,
  Schedule,
  Settings,
  StreamEvent,
  Thread,
  Today,
  Usage,
} from "@shared/api";

export type MemoryName = keyof MemoryFiles;
export type ApprovalDecision = "once" | "always" | "deny";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Everything the UI needs from the server. Implemented by the HTTP client and the mock. */
export interface KinApi {
  login(token: string): Promise<void>;
  bootstrap(): Promise<Bootstrap>;
  onboarding(input: OnboardingInput): Promise<Bootstrap>;

  threads(): Promise<Thread[]>;
  createThread(title: string): Promise<Thread>;
  deleteThread(id: string): Promise<void>;
  messages(threadId: string, opts?: { before?: number; limit?: number }): Promise<Message[]>;
  send(threadId: string, body: { text: string; replyTo?: string; attachments?: string[]; clientId?: string }): Promise<Message>;
  stop(threadId: string): Promise<void>;
  seen(threadId: string): Promise<void>;
  typing(threadId: string, on: boolean): Promise<void>;
  upload(file: File): Promise<Attachment>;
  react(messageId: string, emoji: string): Promise<void>;
  approve(approvalId: string, decision: ApprovalDecision): Promise<void>;

  schedules(): Promise<Schedule[]>;
  patchSchedule(id: string, patch: { enabled: boolean }): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
  runSchedule(id: string): Promise<void>;

  runs(status: "active" | "done", limit?: number): Promise<Run[]>;
  run(id: string): Promise<{ run: Run; log: RunLogEntry[] }>;

  today(): Promise<Today>;
  dismissCard(id: string): Promise<void>;
  dismissIdea(id: string): Promise<void>;
  doIdea(id: string): Promise<Message>;

  goals(): Promise<Goal[]>;
  patchGoal(id: string, patch: Partial<Goal>): Promise<void>;
  deleteGoal(id: string): Promise<void>;

  library(): Promise<LibraryItem[]>;
  libraryRawUrl(path: string): string;
  libraryText(path: string): Promise<string>;

  memory(): Promise<MemoryFiles>;
  putMemory(name: MemoryName, content: string): Promise<void>;

  settings(): Promise<Settings>;
  patchSettings(patch: Partial<Settings>): Promise<Settings>;
  patchAgent(patch: Partial<AgentInfo>): Promise<AgentInfo>;
  usage(): Promise<Usage>;

  pushSubscribe(subscription: PushSubscriptionJSON): Promise<void>;
  pushTest(): Promise<void>;
}

export type StreamStatus = "connecting" | "open" | "closed";

export interface KinStream {
  /**
   * Opens the event stream. Returns a disposer. `onReset` fires when the server says our
   * cursor is too old (close code 4001); the caller must refetch state and reconnect.
   */
  connect(onEvent: (e: StreamEvent) => void, onStatus: (s: StreamStatus) => void, onReset?: () => void): () => void;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "include", headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const res = await fetch(path, init);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j.error ?? j.message ?? msg;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

const enc = encodeURIComponent;

export const httpApi: KinApi = {
  login: (token) => req("POST", "/api/login", { token }),
  bootstrap: () => req("GET", "/api/bootstrap"),
  onboarding: (input) => req("POST", "/api/onboarding", input),

  threads: () => req("GET", "/api/threads"),
  createThread: (title) => req("POST", "/api/threads", { title }),
  deleteThread: (id) => req("DELETE", `/api/threads/${enc(id)}`),
  messages: (threadId, opts = {}) => {
    const q = new URLSearchParams();
    if (opts.before) q.set("before", String(opts.before));
    if (opts.limit) q.set("limit", String(opts.limit));
    return req("GET", `/api/threads/${enc(threadId)}/messages?${q}`);
  },
  send: (threadId, body) => req("POST", `/api/threads/${enc(threadId)}/messages`, body),
  stop: (threadId) => req("POST", `/api/threads/${enc(threadId)}/stop`),
  seen: (threadId) => req("POST", `/api/threads/${enc(threadId)}/seen`),
  typing: (threadId, on) => req("POST", `/api/threads/${enc(threadId)}/typing`, { on }),
  upload: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return req("POST", "/api/uploads", fd);
  },
  react: (messageId, emoji) => req("PUT", `/api/messages/${enc(messageId)}/reactions`, { emoji }),
  approve: (approvalId, decision) => req("POST", `/api/approvals/${enc(approvalId)}`, { decision }),

  schedules: () => req("GET", "/api/schedules"),
  patchSchedule: (id, patch) => req("PATCH", `/api/schedules/${enc(id)}`, patch),
  deleteSchedule: (id) => req("DELETE", `/api/schedules/${enc(id)}`),
  runSchedule: (id) => req("POST", `/api/schedules/${enc(id)}/run`),

  runs: (status, limit = 30) => req("GET", `/api/runs?status=${status}&limit=${limit}`),
  run: (id) => req("GET", `/api/runs/${enc(id)}`),

  today: () => req("GET", "/api/today"),
  dismissCard: (id) => req("POST", `/api/cards/${enc(id)}/dismiss`),
  dismissIdea: (id) => req("POST", `/api/ideas/${enc(id)}/dismiss`),
  doIdea: (id) => req("POST", `/api/ideas/${enc(id)}/do`),

  goals: () => req("GET", "/api/goals"),
  patchGoal: (id, patch) => req("PATCH", `/api/goals/${enc(id)}`, patch),
  deleteGoal: (id) => req("DELETE", `/api/goals/${enc(id)}`),

  library: () => req("GET", "/api/library"),
  libraryRawUrl: (path) => `/api/library/raw?path=${enc(path)}`,
  libraryText: (path) => req("GET", `/api/library/raw?path=${enc(path)}`),

  memory: () => req("GET", "/api/memory"),
  putMemory: (name, content) => req("PUT", `/api/memory/${name}`, { content }),

  settings: () => req("GET", "/api/settings"),
  patchSettings: (patch) => req("PATCH", "/api/settings", patch),
  patchAgent: (patch) => req("PATCH", "/api/agent", patch),
  usage: () => req("GET", "/api/usage"),

  pushSubscribe: (subscription) => req("POST", "/api/push/subscribe", { subscription }),
  pushTest: () => req("POST", "/api/push/test"),
};
