// API contract shared by the server and the PWA. Types only: no runtime imports.

export type Role = "user" | "agent" | "system";
export type MessageKind = "text" | "task" | "approval" | "reminder" | "notice";
export type Receipt = "queued" | "sent" | "delivered" | "read";
export type AgentState =
  | "idle"
  | "listening"
  | "reading"
  | "thinking"
  | "typing"
  | "working"
  | "done"
  | "asleep";

export interface Reaction {
  emoji: string;
  by: "user" | "agent";
}

export interface Attachment {
  id: string;
  url: string;
  name: string;
  mime: string;
}

export interface TaskMeta {
  runId: string;
  title: string;
  status: RunStatus;
  steps: string[];
  result?: string;
}

export interface ApprovalMeta {
  approvalId: string;
  tool: string;
  title: string;
  detail: string;
  input: unknown;
  status: "pending" | "allowed" | "always" | "denied" | "expired";
}

export interface Message {
  id: string;
  threadId: string;
  role: Role;
  kind: MessageKind;
  text: string;
  createdAt: number;
  /** Only on user messages. */
  status?: Receipt;
  readAt?: number;
  replyTo?: string;
  attachments?: Attachment[];
  reactions: Reaction[];
  task?: TaskMeta;
  approval?: ApprovalMeta;
  /** Echo of the id the client generated for an optimistic send. */
  clientId?: string;
  /** "background" when a scheduled/proactive run posted it. */
  source?: "chat" | "background" | "reminder";
}

export interface Thread {
  id: string;
  title: string;
  main: boolean;
  createdAt: number;
  lastMessageAt: number;
  unread: number;
  preview: string;
}

export interface AvatarConfig {
  shape: "bean" | "cloud" | "blob" | "ghost" | "cat" | "star";
  color: string; // hex
  accessory: "none" | "beret" | "glasses" | "bowtie" | "monocle" | "headphones" | "flower";
  eyes: "dot" | "diamond" | "happy" | "sleepy";
}

export interface AgentInfo {
  name: string;
  tagline: string;
  avatar: AvatarConfig;
}

export type Proactivity = "off" | "less" | "more";

export interface Settings {
  timezone: string;
  proactivity: Proactivity;
  quietHours: { start: string; end: string } | null; // "22:00"
  briefTime: string; // "07:00"
  notifications: { messages: boolean; approvals: boolean; tasks: boolean };
  /** Off: actions that send, create, delete or control things run without an approval card. */
  askBeforeActing: boolean;
}

export interface Connection {
  id: string;
  name: string;
  status: "connected" | "needs_auth" | "error" | "unknown";
  detail?: string;
}

export interface Bootstrap {
  onboarded: boolean;
  agent: AgentInfo;
  state: Record<string, { state: AgentState; status: string }>; // keyed by threadId
  threads: Thread[];
  settings: Settings;
  vapidPublicKey: string;
  connections: Connection[];
  pendingApprovals: Message[];
  seq: number;
}

export type RunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "ok"
  | "error"
  | "aborted"
  | "timeout";
export type RunKind = "chat" | "task" | "schedule" | "brief" | "heartbeat" | "consolidate" | "goal";

export interface Run {
  id: string;
  kind: RunKind;
  title: string;
  threadId: string | null;
  status: RunStatus;
  model: string;
  effort: string;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
  summary: string;
  tokens: number;
}

export interface RunLogEntry {
  at: number;
  type: "text" | "tool" | "result" | "error" | "status";
  text: string;
}

export interface Schedule {
  id: string;
  title: string;
  kind: "reminder" | "task" | "builtin";
  cron: string | null; // recurring
  at: number | null; // one-shot epoch ms
  timezone: string;
  prompt: string;
  enabled: boolean;
  nextAt: number | null;
  lastAt: number | null;
  human: string; // "Every weekday at 7:00 AM"
}

export interface FeedCard {
  id: string;
  kind: "brief" | "news" | "calendar" | "email" | "weather" | "note" | "goal";
  title: string;
  body: string; // markdown
  createdAt: number;
  actions: { label: string; prompt: string }[];
  dismissed: boolean;
}

export interface Idea {
  id: string;
  title: string;
  why: string;
  prompt: string;
  createdAt: number;
}

export interface Today {
  brief: FeedCard | null;
  cards: FeedCard[];
  ideas: Idea[];
}

export interface Goal {
  id: string;
  title: string;
  category: "health" | "finance" | "career" | "relationships" | "productivity" | "learning" | "home" | "other";
  why: string;
  plan: { step: string; done: boolean }[];
  progress: number; // 0..1
  checkin: string | null; // cron
  lastCheckinAt: number | null;
  notes: string;
  status: "active" | "paused" | "done";
  createdAt: number;
}

export interface LibraryItem {
  path: string; // relative to library/
  title: string;
  mime: string;
  size: number;
  createdAt: number;
  url: string;
}

export interface MemoryFiles {
  soul: string;
  identity: string;
  memory: string;
}

export interface Usage {
  today: { runs: number; tokens: number };
  week: { runs: number; tokens: number };
  byKind: { kind: RunKind; runs: number; tokens: number }[];
  rateLimit: { window: string; utilization: number; resetsAt: number } | null;
  pausedUntil: number | null;
}

export interface OnboardingInput {
  agentName: string;
  avatar: AvatarConfig;
  timezone: string;
  about: { name: string; location?: string; work?: string; interests?: string; notes?: string };
}

/** WebSocket events. The server sends {seq,type,data}; the client resumes with ?since=<seq>. */
export type StreamEvent =
  | { seq: number; type: "message.created"; data: Message }
  | { seq: number; type: "message.updated"; data: Message }
  | { seq: number; type: "message.status"; data: { threadId: string; ids: string[]; status: Receipt; at: number } }
  | { seq: number; type: "reaction"; data: { messageId: string; threadId: string; reactions: Reaction[] } }
  | { seq: number; type: "agent.state"; data: { threadId: string; state: AgentState; status: string } }
  | { seq: number; type: "thread.updated"; data: Thread }
  | { seq: number; type: "thread.deleted"; data: { id: string } }
  | { seq: number; type: "run.updated"; data: Run }
  | { seq: number; type: "approval.resolved"; data: { approvalId: string; status: ApprovalMeta["status"] } }
  | { seq: number; type: "today.updated"; data: Record<string, never> }
  | { seq: number; type: "goals.updated"; data: Record<string, never> }
  | { seq: number; type: "schedules.updated"; data: Record<string, never> }
  | { seq: number; type: "library.updated"; data: Record<string, never> }
  | { seq: number; type: "usage.updated"; data: Usage };

/*
REST (JSON, cookie session `kin` from POST /api/login {token}; or Authorization: Bearer):
  POST   /api/login {token}                      -> {ok}
  GET    /api/bootstrap                          -> Bootstrap
  POST   /api/onboarding OnboardingInput         -> Bootstrap
  GET    /api/threads                            -> Thread[]
  POST   /api/threads {title}                    -> Thread
  DELETE /api/threads/:id
  GET    /api/threads/:id/messages?before=&limit -> Message[] (ascending)
  POST   /api/threads/:id/messages {text, replyTo?, attachments?: string[], clientId?} -> Message
  POST   /api/threads/:id/stop
  POST   /api/threads/:id/seen                   -> marks agent messages seen (badge)
  POST   /api/threads/:id/typing {on}            -> agent "listening" state
  POST   /api/uploads (multipart "file")         -> Attachment
  GET    /api/files/:id                          -> file bytes
  PUT    /api/messages/:id/reactions {emoji}     -> toggles the user's reaction (one per message, iMessage tapback style)
  POST   /api/approvals/:id {decision: "once"|"always"|"deny"}
  GET    /api/schedules -> Schedule[]; PATCH /api/schedules/:id {enabled}; DELETE /api/schedules/:id; POST /api/schedules/:id/run
  GET    /api/runs?status=active|done&limit= -> Run[];  GET /api/runs/:id -> {run: Run, log: RunLogEntry[]}
  GET    /api/today -> Today; POST /api/cards/:id/dismiss; POST /api/ideas/:id/dismiss; POST /api/ideas/:id/do -> Message
  GET    /api/goals -> Goal[]; PATCH /api/goals/:id Partial<Goal>; DELETE /api/goals/:id
  GET    /api/library -> LibraryItem[];  GET /api/library/raw?path=
  GET    /api/memory -> MemoryFiles;  PUT /api/memory/:name {content}  (name: soul|identity|memory)
  GET    /api/settings -> Settings; PATCH /api/settings Partial<Settings>
  PATCH  /api/agent Partial<AgentInfo> -> AgentInfo
  GET    /api/usage -> Usage
  POST   /api/push/subscribe {subscription}; POST /api/push/test
WS: /api/stream?since=<seq>
*/
