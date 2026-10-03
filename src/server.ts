import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import { env } from "./config.js";
import { id, now, parse } from "./db.js";
import { MEMORY_FILES, readMemory, writeMemory, type MemoryName } from "./home.js";
import { handleMcp, libraryIndex } from "./mcp.js";
import type { App } from "./app.js";
import type { Bootstrap, FeedCard, Idea, LibraryItem, RunLogEntry, StreamEvent } from "./shared/api.js";

const MIME: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".py": "text/x-python",
  ".sh": "text/x-shellscript",
  ".ts": "text/plain",
};
const mimeOf = (p: string) => MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream";

/** User and agent files are untrusted: never let them run script on Kin's origin. */
function untrustedFile(body: Buffer, mime: string, name: string, cache = "private, no-cache") {
  const active = /^(text\/html|image\/svg\+xml|application\/xhtml|text\/xml|application\/xml|text\/javascript)/i.test(mime);
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": active ? "text/plain; charset=utf-8" : mime,
      "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
      "content-disposition": `${active ? "attachment" : "inline"}; filename="${name.replace(/[^\w.-]+/g, "_")}"`,
      "cache-control": cache,
    },
  });
}

function sessionValue(token: string) {
  return crypto.createHash("sha256").update(`kin-session:${token}`).digest("base64url");
}

function authorized(app: App, cookie: string | undefined, header: string | undefined) {
  const expected = sessionValue(app.secrets.ownerToken);
  const bearer = (header ?? "").replace(/^Bearer\s+/i, "");
  const safeEq = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  return (!!cookie && safeEq(cookie, expected)) || (!!bearer && safeEq(bearer, app.secrets.ownerToken));
}

function webRoot() {
  if (env.webDist) return env.webDist;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "web", "dist");
}

export function buildApi(app: App) {
  const api = new Hono();

  api.post("/mcp", (c) => handleMcp(app, c.req.raw));
  api.get("/mcp", (c) => handleMcp(app, c.req.raw));
  api.delete("/mcp", (c) => handleMcp(app, c.req.raw));

  api.post("/api/login", async (c) => {
    const { token } = await c.req.json().catch(() => ({ token: "" }));
    if (typeof token !== "string" || !authorized(app, undefined, `Bearer ${token.trim()}`)) return c.json({ error: "Wrong token" }, 401);
    const secure = c.req.header("x-forwarded-proto") === "https" || c.req.url.startsWith("https:");
    setCookie(c, "kin", sessionValue(app.secrets.ownerToken), { httpOnly: true, sameSite: "Lax", secure, path: "/", maxAge: 400 * 86400 });
    return c.json({ ok: true });
  });

  api.use("/api/*", async (c, next) => {
    if (!authorized(app, getCookie(c, "kin"), c.req.header("authorization"))) return c.json({ error: "Unauthorized" }, 401);
    await next();
  });

  api.onError((e, c) => {
    if (e instanceof z.ZodError) return c.json({ error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
    if ((e as any).status === 404) return c.json({ error: e.message }, 404);
    app.log("http", `${c.req.method} ${c.req.path}: ${e.stack ?? e}`);
    return c.json({ error: e.message || "Server error" }, 500);
  });

  const bootstrap = (): Bootstrap => {
    const state: Bootstrap["state"] = {};
    for (const [threadId, s] of app.sessions) state[threadId] = { state: s.state, status: s.status };
    return {
      onboarded: app.onboarded(),
      agent: app.agent(),
      state,
      threads: app.messages.threads(),
      settings: app.settings(),
      vapidPublicKey: app.push.publicKey,
      connections: app.connections(),
      pendingApprovals: app.approvals.pending(),
      seq: app.bus.lastSeq(),
    };
  };

  api.get("/api/bootstrap", (c) => c.json(bootstrap()));

  const avatarSchema = z.object({
    shape: z.enum(["bean", "cloud", "blob", "ghost", "cat", "star"]),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accessory: z.enum(["none", "beret", "glasses", "bowtie", "monocle", "headphones", "flower"]),
    eyes: z.enum(["dot", "diamond", "happy", "sleepy"]),
  });

  api.post("/api/onboarding", async (c) => {
    const body = z
      .object({
        agentName: z.string().min(1).max(40),
        avatar: avatarSchema,
        timezone: z.string().min(1),
        about: z.object({
          name: z.string().min(1).max(80),
          location: z.string().max(200).optional(),
          work: z.string().max(400).optional(),
          interests: z.string().max(800).optional(),
          notes: z.string().max(2000).optional(),
        }),
      })
      .parse(await c.req.json());
    new Intl.DateTimeFormat("en-US", { timeZone: body.timezone });
    app.onboard(body);
    return c.json(bootstrap());
  });

  // ---- threads & messages ---------------------------------------------------

  api.get("/api/threads", (c) => c.json(app.messages.threads()));

  api.post("/api/threads", async (c) => {
    const { title } = z.object({ title: z.string().min(1).max(80) }).parse(await c.req.json());
    const threadId = id("t_");
    app.store.run("INSERT INTO threads(id,title,main,created_at,last_message_at) VALUES(?,?,0,?,?)", threadId, title, now(), now());
    const t = app.messages.thread(threadId)!;
    app.bus.publish("thread.updated", t);
    return c.json(t);
  });

  api.delete("/api/threads/:id", (c) => {
    const threadId = c.req.param("id");
    const t = app.messages.thread(threadId);
    if (!t) return c.json({ error: "Not found" }, 404);
    if (t.main) return c.json({ error: "The main chat can't be deleted" }, 400);
    app.sessions.get(threadId)?.kill();
    app.sessions.delete(threadId);
    for (const r of app.store.all<{ id: string }>("SELECT id FROM runs WHERE thread_id=? AND status IN ('queued','running','waiting')", threadId))
      app.runner.cancel(r.id);
    app.store.run("DELETE FROM messages WHERE thread_id=?", threadId);
    app.store.run("DELETE FROM threads WHERE id=?", threadId);
    app.bus.publish("thread.deleted", { id: threadId });
    return c.json({ ok: true });
  });

  const thread = (c: Context) => {
    const t = app.messages.thread(c.req.param("id")!);
    if (!t) throw Object.assign(new Error("Unknown thread"), { status: 404 });
    return t;
  };

  api.get("/api/threads/:id/messages", (c) => {
    const t = thread(c);
    const before = c.req.query("before");
    return c.json(app.messages.list(t.id, before ? Number(before) : undefined, Number(c.req.query("limit") ?? 60)));
  });

  api.post("/api/threads/:id/messages", async (c) => {
    const t = thread(c);
    const body = z
      .object({
        text: z.string().max(20000).default(""),
        replyTo: z.string().optional(),
        attachments: z.array(z.string()).max(10).optional(),
        clientId: z.string().max(64).optional(),
      })
      .parse(await c.req.json());
    const attachments = (body.attachments ?? [])
      .map((a) => app.store.get<any>("SELECT * FROM uploads WHERE id=?", a))
      .filter(Boolean)
      .map((u) => ({ id: u.id, url: `/api/files/${u.id}`, name: u.name, mime: u.mime }));
    if (!body.text.trim() && !attachments.length) return c.json({ error: "Empty message" }, 400);
    const message = app.messages.create({
      threadId: t.id,
      role: "user",
      text: body.text,
      status: "sent",
      replyTo: body.replyTo,
      attachments,
      clientId: body.clientId,
    });
    app.store.run("UPDATE threads SET seen_at=? WHERE id=?", now(), t.id);
    app.session(t.id).send(message);
    return c.json(app.messages.get(message.id));
  });

  api.post("/api/threads/:id/stop", (c) => {
    const t = thread(c);
    const stopped = app.session(t.id).interrupt();
    for (const r of app.store.all<{ id: string }>("SELECT id FROM runs WHERE thread_id=? AND kind='task' AND status IN ('queued','running','waiting')", t.id))
      app.runner.cancel(r.id);
    return c.json({ ok: true, stopped });
  });

  api.post("/api/threads/:id/seen", (c) => {
    const t = thread(c);
    app.store.run("UPDATE threads SET seen_at=? WHERE id=?", now(), t.id);
    app.bus.publish("thread.updated", app.messages.thread(t.id)!);
    return c.json({ ok: true });
  });

  api.post("/api/threads/:id/typing", async (c) => {
    const t = thread(c);
    const { on } = z.object({ on: z.boolean() }).parse(await c.req.json());
    app.session(t.id).listening(on);
    return c.json({ ok: true });
  });

  api.put("/api/messages/:id/reactions", async (c) => {
    const { emoji } = z.object({ emoji: z.string().min(1).max(16) }).parse(await c.req.json());
    const msg = app.messages.get(c.req.param("id"));
    if (!msg) return c.json({ error: "Not found" }, 404);
    const { message, added } = app.messages.react(msg.id, "user", emoji);
    if (msg.role === "agent" && msg.kind === "text") {
      const snippet = msg.text.slice(0, 160).replace(/\s+/g, " ");
      app.session(msg.threadId).reactionNote(added ? `The user reacted ${added} to your message ${msg.id}: "${snippet}"` : `The user removed their reaction from your message ${msg.id}.`);
    }
    return c.json(message);
  });

  // ---- uploads ----------------------------------------------------------------

  api.post("/api/uploads", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "No file" }, 400);
    if (file.size > 25 * 1024 * 1024) return c.json({ error: "File too large (25 MB max)" }, 413);
    const uploadId = id("f_");
    const safe = (file.name || "upload").replace(/[^\w.-]+/g, "_").slice(-80);
    const dest = path.join(app.paths.home, "inbox", `${uploadId}-${safe}`);
    fs.writeFileSync(dest, Buffer.from(await file.arrayBuffer()));
    const mime = file.type || mimeOf(safe);
    app.store.run("INSERT INTO uploads(id,path,name,mime,created_at) VALUES(?,?,?,?,?)", uploadId, dest, file.name || safe, mime, now());
    return c.json({ id: uploadId, url: `/api/files/${uploadId}`, name: file.name || safe, mime });
  });

  api.get("/api/files/:id", (c) => {
    const u = app.store.get<any>("SELECT * FROM uploads WHERE id=?", c.req.param("id"));
    if (!u || !fs.existsSync(u.path)) return c.json({ error: "Not found" }, 404);
    return untrustedFile(fs.readFileSync(u.path), u.mime, u.name, "private, max-age=31536000, immutable");
  });

  // ---- approvals ----------------------------------------------------------------

  api.post("/api/approvals/:id", async (c) => {
    const { decision } = z.object({ decision: z.enum(["once", "always", "deny"]) }).parse(await c.req.json());
    const ok = app.approvals.resolve(c.req.param("id"), decision);
    return ok ? c.json({ ok: true }) : c.json({ error: "Already answered or expired" }, 409);
  });

  // ---- schedules & runs -----------------------------------------------------------

  api.get("/api/schedules", (c) => c.json(app.scheduler.list(true)));
  api.patch("/api/schedules/:id", async (c) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
    return c.json(app.scheduler.setEnabled(c.req.param("id"), enabled));
  });
  api.delete("/api/schedules/:id", (c) => c.json({ ok: app.scheduler.remove(c.req.param("id")) }));
  api.post("/api/schedules/:id/run", (c) => {
    app.scheduler.run(c.req.param("id"));
    return c.json({ ok: true });
  });

  api.get("/api/runs", (c) => {
    const status = c.req.query("status");
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const where =
      status === "active"
        ? "status IN ('queued','running','waiting')"
        : status === "done"
          ? "status NOT IN ('queued','running','waiting')"
          : "1=1";
    const rows = app.store.all<{ id: string }>(`SELECT id FROM runs WHERE kind!='chat' AND ${where} ORDER BY created_at DESC LIMIT ?`, limit);
    return c.json(rows.map((r) => app.runner.get(r.id)));
  });

  api.get("/api/runs/:id", (c) => {
    const run = app.runner.get(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    const log: RunLogEntry[] = app.store
      .all<any>("SELECT at,type,text FROM run_log WHERE run_id=? ORDER BY id", run.id)
      .map((l) => ({ at: l.at, type: l.type, text: l.text }));
    return c.json({ run, log });
  });

  api.post("/api/runs/:id/cancel", (c) => c.json({ ok: app.runner.cancel(c.req.param("id")) }));

  // ---- today, goals, library ---------------------------------------------------------

  const card = (r: any): FeedCard => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    createdAt: r.created_at,
    actions: parse(r.actions, []),
    dismissed: !!r.dismissed,
  });

  api.get("/api/today", (c) => {
    const brief = app.store.get<any>("SELECT * FROM cards WHERE kind='brief' AND dismissed=0 AND created_at>=? ORDER BY created_at DESC LIMIT 1", now() - 20 * 3600_000);
    const cards = app.store
      .all<any>("SELECT * FROM cards WHERE kind!='brief' AND dismissed=0 AND created_at>=? ORDER BY created_at DESC LIMIT 30", now() - 3 * 86400_000)
      .map(card);
    const ideas: Idea[] = app.store
      .all<any>("SELECT * FROM ideas WHERE dismissed=0 ORDER BY created_at DESC LIMIT 12")
      .map((r) => ({ id: r.id, title: r.title, why: r.why, prompt: r.prompt, createdAt: r.created_at }));
    return c.json({ brief: brief ? card(brief) : null, cards, ideas });
  });

  api.post("/api/cards/:id/dismiss", (c) => {
    app.store.run("UPDATE cards SET dismissed=1 WHERE id=?", c.req.param("id"));
    app.bus.publish("today.updated", {});
    return c.json({ ok: true });
  });

  api.post("/api/ideas/:id/dismiss", (c) => {
    app.store.run("UPDATE ideas SET dismissed=1 WHERE id=?", c.req.param("id"));
    app.bus.publish("today.updated", {});
    return c.json({ ok: true });
  });

  api.post("/api/ideas/:id/do", (c) => {
    const idea = app.store.get<any>("SELECT * FROM ideas WHERE id=?", c.req.param("id"));
    if (!idea) return c.json({ error: "Not found" }, 404);
    app.store.run("UPDATE ideas SET dismissed=1 WHERE id=?", idea.id);
    app.bus.publish("today.updated", {});
    const main = app.messages.mainThread();
    const message = app.messages.create({ threadId: main, role: "user", text: idea.prompt, status: "sent" });
    app.session(main).send(message);
    return c.json(app.messages.get(message.id));
  });

  api.get("/api/goals", (c) => c.json(app.goals.list()));
  api.patch("/api/goals/:id", async (c) => {
    const body = z
      .object({
        title: z.string().min(1).max(120).optional(),
        plan: z.array(z.object({ step: z.string(), done: z.boolean() })).optional(),
        progress: z.number().min(0).max(1).optional(),
        notes: z.string().optional(),
        status: z.enum(["active", "paused", "done"]).optional(),
        checkin: z.string().nullable().optional(),
      })
      .parse(await c.req.json());
    return c.json(app.goals.patch(c.req.param("id"), body));
  });
  api.delete("/api/goals/:id", (c) => {
    app.goals.remove(c.req.param("id"));
    return c.json({ ok: true });
  });

  api.get("/api/library", (c) => {
    const lib = path.join(app.paths.home, "library");
    const index = libraryIndex(app);
    const items: LibraryItem[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith(".")) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else {
          const rel = path.relative(lib, full).split(path.sep).join("/");
          const st = fs.statSync(full);
          items.push({
            path: rel,
            title: index[rel]?.title ?? e.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
            mime: mimeOf(e.name),
            size: st.size,
            createdAt: index[rel]?.createdAt ?? st.mtimeMs,
            url: `/api/library/raw?path=${encodeURIComponent(rel)}`,
          });
        }
      }
    };
    if (fs.existsSync(lib)) walk(lib);
    items.sort((a, b) => b.createdAt - a.createdAt);
    return c.json(items);
  });

  api.get("/api/library/raw", (c) => {
    const lib = path.join(app.paths.home, "library");
    const target = path.resolve(lib, c.req.query("path") ?? "");
    if (!target.startsWith(lib + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return c.json({ error: "Not found" }, 404);
    return untrustedFile(fs.readFileSync(target), mimeOf(target), path.basename(target));
  });

  // ---- memory, settings, agent, usage, push ------------------------------------------

  api.get("/api/memory", (c) =>
    c.json({ soul: readMemory(app.paths.home, "soul"), identity: readMemory(app.paths.home, "identity"), memory: readMemory(app.paths.home, "memory") }),
  );

  api.put("/api/memory/:name", async (c) => {
    const name = c.req.param("name") as MemoryName;
    if (!MEMORY_FILES.includes(name)) return c.json({ error: "Unknown file" }, 404);
    const { content } = z.object({ content: z.string().max(64000) }).parse(await c.req.json());
    writeMemory(app.paths.home, name, content);
    for (const s of app.sessions.values()) s.refresh();
    return c.json({ ok: true });
  });

  api.get("/api/settings", (c) => c.json(app.settings()));
  api.patch("/api/settings", async (c) => {
    const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
    const body = z
      .object({
        timezone: z.string().optional(),
        proactivity: z.enum(["off", "less", "more"]).optional(),
        quietHours: z.object({ start: hhmm, end: hhmm }).nullable().optional(),
        briefTime: hhmm.optional(),
        notifications: z.object({ messages: z.boolean(), approvals: z.boolean(), tasks: z.boolean() }).optional(),
        askBeforeActing: z.boolean().optional(),
      })
      .parse(await c.req.json());
    return c.json(app.setSettings(body));
  });

  api.patch("/api/agent", async (c) => {
    const body = z
      .object({ name: z.string().min(1).max(40).optional(), tagline: z.string().max(80).optional(), avatar: avatarSchema.partial().optional() })
      .parse(await c.req.json());
    return c.json(app.setAgent(body as any));
  });

  api.get("/api/usage", (c) => c.json(app.usage()));

  api.post("/api/push/subscribe", async (c) => {
    const { subscription } = await c.req.json();
    app.push.subscribe(subscription);
    return c.json({ ok: true });
  });

  api.post("/api/push/test", async (c) => {
    await app.push.send({ title: app.agent().name, body: "Notifications are working 👋", kind: "messages", force: true });
    return c.json({ ok: true });
  });

  // ---- static PWA --------------------------------------------------------------------

  const root = path.resolve(webRoot());
  api.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
    if (!fs.existsSync(root)) return c.text("Kin web app not built. Run npm run web:build.", 503);
    let rel: string;
    try {
      rel = decodeURIComponent(c.req.path).replace(/^\/+/, "");
    } catch {
      return c.text("Bad path", 400);
    }
    let file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
    const name = path.basename(file);
    const cache =
      name === "index.html" || name === "sw.js" || name.endsWith(".webmanifest")
        ? "no-cache"
        : rel.startsWith("assets/")
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600";
    return new Response(fs.readFileSync(file), { headers: { "content-type": mimeOf(file), "cache-control": cache } });
  });

  return api;
}

export function startServer(app: App) {
  const api = buildApi(app);
  const server = serve({ fetch: api.fetch, port: app.port, hostname: env.host }) as unknown as import("node:http").Server;
  // Approval cards hold an MCP request open until the owner answers.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 65_000;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/stream") return socket.destroy();
    const cookie = /(?:^|;\s*)kin=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
    if (!authorized(app, cookie, req.headers.authorization)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => connect(ws, Number(url.searchParams.get("since") ?? "")));
  });

  const connect = (ws: WebSocket, since: number) => {
    // Only a client that says it's on screen suppresses push; an open socket alone doesn't
    // (a backgrounded phone or a forgotten desktop tab keeps one open).
    let visible = false;
    const setVisible = (v: boolean) => {
      if (v === visible) return;
      visible = v;
      app.clients += v ? 1 : -1;
    };
    const send = (e: StreamEvent) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(e));
    const backlog = Number.isFinite(since) && since > 0 ? app.bus.since(since) : [];
    if (backlog === null) {
      // Cursor older than retained history: the client must refetch.
      ws.close(4001, "reset");
      return;
    }
    for (const e of backlog) send(e);
    for (const [threadId, s] of app.sessions) send({ seq: app.bus.lastSeq(), type: "agent.state", data: { threadId, state: s.state, status: s.status } });
    const listener = (e: StreamEvent) => send(e);
    app.bus.on("event", listener);
    // Phones suspend backgrounded PWAs without closing the socket; drop connections that stop answering pings
    // so push notifications resume.
    let alive = true;
    ws.on("pong", () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      if (ws.readyState === ws.OPEN) ws.ping();
    }, 20_000);
    ws.on("message", (raw) => {
      try {
        const m = JSON.parse(String(raw));
        if (m?.type === "presence") setVisible(m.visible === true);
      } catch {
        /* ignore */
      }
    });
    ws.on("close", () => {
      setVisible(false);
      clearInterval(ping);
      app.bus.off("event", listener);
    });
    ws.on("error", () => {});
  };

  return server;
}
