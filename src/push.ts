import webpush from "web-push";
import { json, now, parse } from "./db.js";
import { env, saveSecrets } from "./config.js";
import type { App } from "./app.js";
import type { Message } from "./shared/api.js";

type Kind = "messages" | "approvals" | "tasks";

export class Push {
  private pendingChat: { threadId: string; texts: string[]; timer: NodeJS.Timeout } | null = null;

  constructor(readonly app: App) {}

  init() {
    const secrets = this.app.secrets;
    if (!secrets.vapid) {
      secrets.vapid = webpush.generateVAPIDKeys();
      saveSecrets(this.app.paths, secrets);
    }
    webpush.setVapidDetails(env.vapidSubject, secrets.vapid.publicKey, secrets.vapid.privateKey);
  }

  get publicKey() {
    return this.app.secrets.vapid?.publicKey ?? "";
  }

  subscribe(sub: { endpoint: string }) {
    if (!sub?.endpoint) throw new Error("Invalid subscription");
    this.app.store.run(
      "INSERT INTO push_subs(endpoint,sub,created_at) VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET sub=excluded.sub",
      sub.endpoint,
      json(sub),
      now(),
    );
  }

  /** New agent message: notify unless the owner is looking at the app (an open WebSocket). */
  onAgentMessage(m: Message) {
    if (m.kind === "approval" || m.kind === "task") return; // approvals and tasks notify on their own
    const name = this.app.agent().name;
    if (m.kind === "reminder") return void this.send({ title: `⏰ ${name}`, body: m.text, kind: "messages", force: true });
    if (m.source === "chat" && this.app.clientsOnline()) return;
    if (this.pendingChat && this.pendingChat.threadId === m.threadId) {
      this.pendingChat.texts.push(m.text);
      return;
    }
    const entry = {
      threadId: m.threadId,
      texts: [m.text],
      timer: setTimeout(() => {
        this.pendingChat = null;
        this.send({ title: name, body: entry.texts.join("\n"), kind: "messages", url: "/" });
      }, 1500),
    };
    this.pendingChat = entry;
  }

  async send(n: { title: string; body: string; kind: Kind; url?: string; force?: boolean }) {
    const settings = this.app.settings();
    if (!settings.notifications[n.kind] && !n.force) return;
    if (n.kind !== "approvals" && !n.force && this.app.inQuietHours()) return;
    const payload = JSON.stringify({
      title: n.title,
      body: n.body.length > 300 ? `${n.body.slice(0, 297)}…` : n.body,
      url: n.url ?? "/",
      badge: this.app.messages.totalUnread(),
      tag: n.kind === "messages" ? "kin-chat" : undefined,
    });
    const subs = this.app.store.all<{ endpoint: string; sub: string }>("SELECT * FROM push_subs");
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(parse(s.sub, {} as any), payload, { TTL: 3600, urgency: n.kind === "approvals" ? "high" : "normal" });
        } catch (e: any) {
          if (e?.statusCode === 404 || e?.statusCode === 410) this.app.store.run("DELETE FROM push_subs WHERE endpoint=?", s.endpoint);
          else this.app.log("push", `send failed: ${e?.statusCode ?? ""} ${e?.body ?? e}`);
        }
      }),
    );
  }
}
