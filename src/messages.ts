import { id, json, now, parse } from "./db.js";
import type { App } from "./app.js";
import type { ApprovalMeta, Attachment, Message, MessageKind, Reaction, Receipt, Role, TaskMeta, Thread } from "./shared/api.js";

export interface MessageRow {
  id: string;
  thread_id: string;
  role: Role;
  kind: MessageKind;
  text: string;
  created_at: number;
  status: Receipt | null;
  read_at: number | null;
  reply_to: string | null;
  attachments: string | null;
  reactions: string;
  task: string | null;
  approval: string | null;
  source: Message["source"] | null;
  client_id?: string | null;
}

export function toMessage(r: MessageRow): Message {
  const m: Message = {
    id: r.id,
    threadId: r.thread_id,
    role: r.role,
    kind: r.kind,
    text: r.text,
    createdAt: r.created_at,
    reactions: parse<Reaction[]>(r.reactions, []),
  };
  if (r.status) m.status = r.status;
  if (r.read_at) m.readAt = r.read_at;
  if (r.reply_to) m.replyTo = r.reply_to;
  const attachments = parse<Attachment[]>(r.attachments, []);
  if (attachments.length) m.attachments = attachments;
  if (r.task) m.task = parse<TaskMeta | undefined>(r.task, undefined);
  if (r.approval) m.approval = parse<ApprovalMeta | undefined>(r.approval, undefined);
  if (r.source) m.source = r.source;
  if (r.client_id) m.clientId = r.client_id;
  return m;
}

export interface NewMessage {
  threadId: string;
  role: Role;
  kind?: MessageKind;
  text: string;
  status?: Receipt;
  replyTo?: string;
  attachments?: Attachment[];
  task?: TaskMeta;
  approval?: ApprovalMeta;
  source?: Message["source"];
  clientId?: string;
  at?: number;
}

export class Messages {
  constructor(readonly app: App) {}

  get(messageId: string): Message | undefined {
    const row = this.app.store.get<MessageRow>("SELECT * FROM messages WHERE id=?", messageId);
    return row && toMessage(row);
  }

  list(threadId: string, before?: number, limit = 60): Message[] {
    const rows = this.app.store.all<MessageRow>(
      "SELECT * FROM messages WHERE thread_id=? AND created_at<? ORDER BY created_at DESC, rowid DESC LIMIT ?",
      threadId,
      before ?? Number.MAX_SAFE_INTEGER,
      Math.min(limit, 200),
    );
    return rows.reverse().map(toMessage);
  }

  create(input: NewMessage): Message {
    if (!this.app.store.get("SELECT 1 FROM threads WHERE id=?", input.threadId)) throw new Error(`Thread ${input.threadId} no longer exists`);
    const at = Math.max(input.at ?? now(), this.lastAt(input.threadId) + 1);
    const messageId = id("m_");
    this.app.store.run(
      "INSERT INTO messages(id,thread_id,role,kind,text,created_at,status,reply_to,attachments,reactions,task,approval,source,client_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      messageId,
      input.threadId,
      input.role,
      input.kind ?? "text",
      input.text,
      at,
      input.status ?? null,
      input.replyTo ?? null,
      input.attachments?.length ? json(input.attachments) : null,
      "[]",
      input.task ? json(input.task) : null,
      input.approval ? json(input.approval) : null,
      input.source ?? null,
      input.clientId ?? null,
    );
    this.app.store.run("UPDATE threads SET last_message_at=? WHERE id=?", at, input.threadId);
    const message = this.get(messageId)!;
    this.app.bus.publish("message.created", message);
    this.app.bus.publish("thread.updated", this.thread(input.threadId)!);
    if (message.role !== "user") this.app.push.onAgentMessage(message);
    return message;
  }

  private lastAt(threadId: string) {
    return this.app.store.get<{ t: number }>("SELECT COALESCE(MAX(created_at),0) AS t FROM messages WHERE thread_id=?", threadId)!.t;
  }

  update(messageId: string, patch: { text?: string; task?: TaskMeta; approval?: ApprovalMeta }) {
    const row = this.app.store.get<MessageRow>("SELECT * FROM messages WHERE id=?", messageId);
    if (!row) return;
    this.app.store.run(
      "UPDATE messages SET text=?, task=?, approval=? WHERE id=?",
      patch.text ?? row.text,
      patch.task ? json(patch.task) : row.task,
      patch.approval ? json(patch.approval) : row.approval,
      messageId,
    );
    const message = this.get(messageId)!;
    this.app.bus.publish("message.updated", message);
    return message;
  }

  setStatus(threadId: string, ids: string[], status: Receipt) {
    if (!ids.length) return;
    const at = now();
    const order: Receipt[] = ["queued", "sent", "delivered", "read"];
    const changed: string[] = [];
    for (const messageId of ids) {
      const row = this.app.store.get<{ status: Receipt }>("SELECT status FROM messages WHERE id=?", messageId);
      if (!row || order.indexOf(row.status) >= order.indexOf(status)) continue;
      this.app.store.run("UPDATE messages SET status=?, read_at=? WHERE id=?", status, status === "read" ? at : null, messageId);
      changed.push(messageId);
    }
    if (changed.length) this.app.bus.publish("message.status", { threadId, ids: changed, status, at });
  }

  /** Tapback semantics: one reaction per side per message; the same emoji again removes it. */
  react(messageId: string, by: "user" | "agent", emoji: string | null) {
    const row = this.app.store.get<MessageRow>("SELECT * FROM messages WHERE id=?", messageId);
    if (!row) throw new Error("Unknown message");
    let reactions = parse<Reaction[]>(row.reactions, []);
    const existing = reactions.find((r) => r.by === by);
    reactions = reactions.filter((r) => r.by !== by);
    if (emoji && existing?.emoji !== emoji) reactions.push({ emoji, by });
    this.app.store.run("UPDATE messages SET reactions=? WHERE id=?", json(reactions), messageId);
    this.app.bus.publish("reaction", { messageId, threadId: row.thread_id, reactions });
    return { message: toMessage({ ...row, reactions: json(reactions) }), added: reactions.find((r) => r.by === by)?.emoji ?? null };
  }

  thread(threadId: string): Thread | undefined {
    const t = this.app.store.get<any>("SELECT * FROM threads WHERE id=?", threadId);
    if (!t) return;
    const last = this.app.store.get<MessageRow>(
      "SELECT * FROM messages WHERE thread_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      threadId,
    );
    const unread = this.app.store.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM messages WHERE thread_id=? AND role!='user' AND created_at>?",
      threadId,
      t.seen_at,
    )!.n;
    return {
      id: t.id,
      title: t.title,
      main: !!t.main,
      createdAt: t.created_at,
      lastMessageAt: t.last_message_at,
      unread,
      preview: last ? (last.kind === "text" ? last.text : (parse<any>(last.task, null)?.title ?? last.text)).slice(0, 120) : "",
    };
  }

  threads(): Thread[] {
    return this.app.store
      .all<{ id: string }>("SELECT id FROM threads ORDER BY main DESC, last_message_at DESC")
      .map((t) => this.thread(t.id)!);
  }

  mainThread(): string {
    const row = this.app.store.get<{ id: string }>("SELECT id FROM threads WHERE main=1");
    if (row) return row.id;
    const threadId = id("t_");
    this.app.store.run("INSERT INTO threads(id,title,main,created_at,last_message_at) VALUES(?,?,1,?,?)", threadId, "Main", now(), now());
    return threadId;
  }

  totalUnread() {
    return this.threads().reduce((n, t) => n + t.unread, 0);
  }
}
