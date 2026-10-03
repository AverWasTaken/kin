import type {
  AgentInfo,
  Attachment,
  AgentState,
  ApprovalMeta,
  Bootstrap,
  Goal,
  Message,
  Reaction,
  Run,
  Settings,
  StreamEvent,
  Thread,
  Today,
} from "@shared/api";
import { ApiError, type KinApi, type KinStream } from "../lib/api";
import * as F from "./fixtures";

/* ------------------------------------------------------------------ state */

type EventInput = StreamEvent extends infer E ? (E extends { seq: number } ? Omit<E, "seq"> : never) : never;

const q = new URLSearchParams(location.search);
const fresh = q.get("fresh") === "1";
let signedIn = q.get("signedout") !== "1";

const db = {
  seq: 100,
  onboarded: !fresh,
  agent: structuredClone(F.agent) as AgentInfo,
  settings: structuredClone(F.settings) as Settings,
  threads: [] as Thread[],
  messages: {} as Record<string, Message[]>,
  state: {} as Record<string, { state: AgentState; status: string }>,
  today: F.today() as Today,
  goals: F.goals() as Goal[],
  library: F.library(),
  schedules: F.schedules(),
  runs: F.runs() as Run[],
  memory: structuredClone(F.memory),
};

function seed() {
  const side = F.sideThreads();
  const main = fresh ? [] : F.mainThreadMessages();
  const last = main[main.length - 1];
  db.threads = [
    {
      id: F.MAIN,
      title: db.agent.name,
      main: true,
      createdAt: F.ago(30 * F.DAY),
      lastMessageAt: last?.createdAt ?? Date.now(),
      unread: 0,
      preview: last?.text ?? "",
    },
    ...(fresh ? [] : side.threads),
  ];
  db.messages = { [F.MAIN]: main, ...(fresh ? {} : side.messages) };
  for (const t of db.threads) db.state[t.id] = { state: "idle", status: "active now" };
}
seed();

const listeners = new Set<(e: StreamEvent) => void>();

function emit(e: EventInput) {
  const ev = { ...e, seq: ++db.seq } as StreamEvent;
  queueMicrotask(() => listeners.forEach((l) => l(ev)));
}

const wait = (ms = 60 + Math.random() * 120) => new Promise((r) => setTimeout(r, ms));

function findMessage(id: string): Message | undefined {
  for (const list of Object.values(db.messages)) {
    const m = list.find((x) => x.id === id);
    if (m) return m;
  }
}

function put(m: Message, created: boolean) {
  const list = (db.messages[m.threadId] ??= []);
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) list[i] = m;
  else list.push(m);
  emit({ type: created ? "message.created" : "message.updated", data: structuredClone(m) });
  const t = db.threads.find((x) => x.id === m.threadId);
  if (t && created) {
    t.lastMessageAt = m.createdAt;
    t.preview = m.kind === "text" ? m.text : m.task?.title ?? m.approval?.title ?? m.text.split("\n")[0];
    if (m.role === "agent") t.unread++;
    emit({ type: "thread.updated", data: { ...t } });
  }
}

function setState(threadId: string, state: AgentState, status: string) {
  db.state[threadId] = { state, status };
  emit({ type: "agent.state", data: { threadId, state, status } });
}

function agentMsg(threadId: string, text: string, extra: Partial<Message> = {}): Message {
  return { id: F.uid("m"), threadId, role: "agent", kind: "text", text, createdAt: Date.now(), reactions: [], source: "chat", ...extra };
}

/* ------------------------------------------------------------ simulation */

interface Job {
  threadId: string;
  msg: Message;
}
const queue: Record<string, Job[]> = {};
const busy: Record<string, boolean> = {};
const timers: Record<string, ReturnType<typeof setTimeout>[]> = {};

function later(threadId: string, ms: number, fn: () => void) {
  (timers[threadId] ??= []).push(setTimeout(fn, ms));
}

function pickReaction(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b(thanks|thank you|thx|ty|love|amazing|best|great)\b|❤️|🙏/.test(t)) return "❤️";
  if (/(haha|lol|lmao|😂)/.test(t)) return "😂";
  if (/\b(ok|okay|k|kk|cool|nice|got it|sure|sounds good|perfect|yes)\b|👍/.test(t)) return "👍";
  if (/!!|\bwow\b|\bomg\b/.test(t)) return "‼️";
  return null;
}

interface Plan {
  working?: string;
  bubbles: string[];
  card?: (threadId: string) => Message;
  after?: (threadId: string, card: Message | undefined) => void;
}

/** Short acknowledgements get a tapback and no reply, like a person would. */
const ACK = /^(ok|okay|k|kk|cool|nice|got it|sounds good|perfect|great|thanks|thank you|thx|ty|lol|haha|👍|❤️|🙏|😂)[\s!.]*$/iu;

function plan(text: string): Plan {
  const t = text.toLowerCase();
  if (ACK.test(text.trim())) return { bubbles: [] };
  if (/\bemail\b|\bmail\b|\bsend\b/.test(t)) {
    return {
      working: "drafting the email…",
      bubbles: ["Here's a draft. I need your OK before anything goes out."],
      card: (threadId) =>
        agentMsg(threadId, "Send an email", {
          kind: "approval",
          approval: {
            approvalId: F.uid("ap"),
            tool: "gmail.send",
            title: "Send an email to Dana Kim",
            detail: "To: dana@northwind.co\nSubject: Running 10 min late\n\nHi Dana, I'm running about 10 minutes behind for our 2pm. See you at 2:10!\n\nSam",
            input: { to: ["dana@northwind.co"], subject: "Running 10 min late" },
            status: "pending",
          },
        }),
    };
  }
  if (/research|look into|dig into|find out/.test(t)) {
    return {
      working: "starting a background task…",
      bubbles: ["On it. I'll work on this in the background and ping you when it's done."],
      card: (threadId) => {
        const runId = F.uid("r");
        const run: Run = {
          id: runId,
          kind: "task",
          title: "Research: best e-bikes under $2,000",
          threadId,
          status: "running",
          model: "claude-sonnet-5-5",
          effort: "medium",
          startedAt: Date.now(),
          endedAt: null,
          createdAt: Date.now(),
          summary: "",
          tokens: 0,
        };
        db.runs.unshift(run);
        emit({ type: "run.updated", data: { ...run } });
        return agentMsg(threadId, run.title, {
          kind: "task",
          task: { runId, title: run.title, status: "running", steps: ["Searching reviews"] },
        });
      },
      after: (threadId, card) => {
        if (!card?.task) return;
        const steps = ["Searching reviews", "Comparing 9 models", "Checking local stock", "Writing it up"];
        steps.slice(1).forEach((_, i) => {
          later(threadId, 2600 * (i + 1), () => {
            card.task = { ...card.task!, steps: steps.slice(0, i + 2) };
            put(card, false);
          });
        });
        later(threadId, 2600 * steps.length, () => {
          card.task = {
            ...card.task!,
            status: "ok",
            steps,
            result: "Top pick: **Aventon Level 3** ($1,799). Great range, hydraulic brakes, and the shop on Valencia has it in stock. Full comparison is in your Library.",
          };
          put(card, false);
          const run = db.runs.find((r) => r.id === card.task!.runId);
          if (run) {
            Object.assign(run, { status: "ok", endedAt: Date.now(), tokens: 38_200, summary: "Compared 9 e-bikes. Saved to Library." });
            emit({ type: "run.updated", data: { ...run } });
          }
          db.library.unshift({ path: "research/e-bikes.md", title: "E-bikes under $2,000", mime: "text/markdown", size: 2200, createdAt: Date.now(), url: "" });
          F.libraryText["research/e-bikes.md"] = "# E-bikes under $2,000\n\n1. **Aventon Level 3**, $1,799\n2. **Rad Power Radster**, $1,999\n3. **Lectric XP Trike**, $1,499\n";
          emit({ type: "library.updated", data: {} });
          put(agentMsg(threadId, "Done! The e-bike rundown is in your Library 🚲"), true);
        });
      },
    };
  }
  if (/remind/.test(t)) {
    return {
      working: "setting a reminder…",
      bubbles: ["Got it. I'll ping you then."],
      card: (threadId) => agentMsg(threadId, "Water the plants\nTomorrow at 9:00 AM", { kind: "reminder" }),
      after: () => emit({ type: "schedules.updated", data: {} }),
    };
  }
  if (/weather|rain|forecast/.test(t)) {
    return { working: "checking the forecast…", bubbles: ["Clear and 19° on Saturday 🌤", "Rain holds off until about 4pm, so a morning start is perfect."] };
  }
  if (/calendar|today|schedule|meeting/.test(t)) {
    return {
      working: "checking your calendar…",
      bubbles: ["Here's the rest of your day:", "- **10:00** Design review with Dana\n- **15:30** Dentist\n- **18:10** Maya lands"],
    };
  }
  if (/code|script|regex/.test(t)) {
    return {
      bubbles: ["Something like this:", "```js\nconst slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, \"-\");\n```", "Want me to add tests?"],
    };
  }
  if (/^(hi|hey|hello|yo|morning)\b/.test(t)) {
    return { bubbles: ["Hey! 👋", "What's on your mind?"] };
  }
  const generic = [
    ["Got it.", "Want me to do anything with that, or just keeping me posted?"],
    ["Ooh, good question.", "Short answer: yes. Longer answer: it depends on how much time you've got this week."],
    ["Noted ✍️"],
    ["On it. I'll let you know what I find."],
  ];
  return { bubbles: generic[Math.floor(Math.random() * generic.length)] };
}

function runJob(job: Job) {
  const { threadId, msg } = job;
  busy[threadId] = true;
  const p = plan(msg.text);

  later(threadId, 300, () => {
    msg.status = "delivered";
    emit({ type: "message.status", data: { threadId, ids: [msg.id], status: "delivered", at: Date.now() } });
  });
  later(threadId, 650, () => setState(threadId, "reading", "reading…"));
  later(threadId, 900, () => {
    msg.status = "read";
    msg.readAt = Date.now();
    emit({ type: "message.status", data: { threadId, ids: [msg.id], status: "read", at: Date.now() } });
  });
  const reaction = pickReaction(msg.text);
  if (reaction) {
    later(threadId, 1200, () => {
      msg.reactions = [...msg.reactions.filter((r) => r.by !== "agent"), { emoji: reaction, by: "agent" }];
      emit({ type: "reaction", data: { messageId: msg.id, threadId, reactions: msg.reactions } });
    });
  }
  let t = 1500;
  later(threadId, t, () => setState(threadId, "thinking", "thinking…"));
  t += 1100;
  // Reaction-only turn: the tapback was the whole answer, so done → idle with no bubble.
  if (!p.bubbles.length && !p.card) {
    later(threadId, t, () => setState(threadId, "done", "done"));
    later(threadId, t + 900, () => {
      setState(threadId, "idle", "active now");
      busy[threadId] = false;
      const next = queue[threadId]?.shift();
      if (next) runJob(next);
    });
    return;
  }
  if (p.working) {
    later(threadId, t, () => setState(threadId, "working", p.working!));
    t += 1800;
  }
  later(threadId, t, () => setState(threadId, "typing", "typing…"));
  t += 1500;
  later(threadId, t, () => {
    p.bubbles.forEach((b) => put(agentMsg(threadId, b), true));
    const card = p.card?.(threadId);
    if (card) put(card, true);
    p.after?.(threadId, card);
    setState(threadId, "done", "done");
  });
  later(threadId, t + 1400, () => {
    setState(threadId, "idle", "active now");
    busy[threadId] = false;
    const next = queue[threadId]?.shift();
    if (next) runJob(next);
  });
}

function enqueue(job: Job) {
  if (busy[job.threadId]) {
    (queue[job.threadId] ??= []).push(job);
    return;
  }
  runJob(job);
}

function introSequence() {
  const tid = F.MAIN;
  setTimeout(() => setState(tid, "thinking", "thinking…"), 700);
  setTimeout(() => setState(tid, "typing", "typing…"), 1700);
  setTimeout(() => {
    put(agentMsg(tid, `Hi! I'm ${db.agent.name} 👋`), true);
    put(agentMsg(tid, "I'll keep track of the little things, check your calendar and inbox when you ask, and nudge you when something needs you."), true);
    put(agentMsg(tid, "What's one thing I can take off your plate this week?"), true);
    setState(tid, "done", "done");
  }, 3200);
  setTimeout(() => setState(tid, "idle", "active now"), 4600);
}

/* ------------------------------------------------------------------- API */

function snapshot(): Bootstrap {
  return structuredClone({
    onboarded: db.onboarded,
    agent: db.agent,
    state: db.state,
    threads: db.threads,
    settings: db.settings,
    vapidPublicKey: "BMockVapidKeyForDevelopmentOnly-0000000000000000000000000000000000000000000000000000000",
    connections: F.connections,
    pendingApprovals: Object.values(db.messages)
      .flat()
      .filter((m) => m.approval?.status === "pending"),
    seq: db.seq,
  });
}

function decide(m: Message, status: ApprovalMeta["status"]) {
  m.approval = { ...m.approval!, status };
  emit({ type: "approval.resolved", data: { approvalId: m.approval.approvalId, status } });
  put(m, false);
  const tid = m.threadId;
  later(tid, 400, () => setState(tid, "typing", "typing…"));
  later(tid, 1500, () => {
    put(agentMsg(tid, status === "denied" ? "Okay, I won't send it." : "Sent ✓ Dana will see it in a sec."), true);
    setState(tid, "idle", "active now");
  });
}

const blobUrls: Record<string, string> = {};
const uploads: Record<string, Attachment> = {};

export const mockApi: KinApi = {
  async login(token) {
    await wait(400);
    if (!token.trim()) throw new ApiError(401, "That token didn't work");
    signedIn = true;
  },
  async bootstrap() {
    await wait();
    if (!signedIn) throw new ApiError(401, "Sign in required");
    return snapshot();
  },
  async onboarding(input) {
    await wait(500);
    db.onboarded = true;
    db.agent = { ...db.agent, name: input.agentName, avatar: input.avatar, tagline: "" };
    db.settings.timezone = input.timezone;
    db.threads[0].title = input.agentName;
    introSequence();
    return snapshot();
  },

  async threads() {
    await wait();
    return structuredClone(db.threads);
  },
  async createThread(title) {
    await wait();
    const t: Thread = { id: F.uid("t"), title, main: false, createdAt: Date.now(), lastMessageAt: Date.now(), unread: 0, preview: "" };
    db.threads.push(t);
    db.messages[t.id] = [];
    db.state[t.id] = { state: "idle", status: "active now" };
    return { ...t };
  },
  async deleteThread(id) {
    await wait();
    db.threads = db.threads.filter((t) => t.id !== id);
    emit({ type: "thread.deleted", data: { id } });
  },
  async messages(threadId, opts = {}) {
    await wait();
    const all = db.messages[threadId] ?? [];
    const limit = opts.limit ?? 40;
    const before = opts.before ?? Infinity;
    const older = all.filter((m) => m.createdAt < before);
    return structuredClone(older.slice(Math.max(0, older.length - limit)));
  },
  async send(threadId, body) {
    await wait(80);
    const m: Message = {
      id: F.uid("m"),
      threadId,
      role: "user",
      kind: "text",
      text: body.text,
      createdAt: Date.now(),
      status: busy[threadId] ? "queued" : "sent",
      replyTo: body.replyTo,
      clientId: body.clientId,
      attachments: body.attachments?.map((id) => uploads[id]).filter((a): a is Attachment => !!a),
      reactions: [],
      source: "chat",
    };
    put(m, true);
    enqueue({ threadId, msg: m });
    return structuredClone(m);
  },
  async stop(threadId) {
    timers[threadId]?.forEach(clearTimeout);
    timers[threadId] = [];
    queue[threadId] = [];
    busy[threadId] = false;
    setState(threadId, "idle", "active now");
    put(agentMsg(threadId, "Okay, stopped."), true);
  },
  async seen(threadId) {
    const t = db.threads.find((x) => x.id === threadId);
    if (t && t.unread) {
      t.unread = 0;
      emit({ type: "thread.updated", data: { ...t } });
    }
  },
  async typing(threadId, on) {
    const s = db.state[threadId]?.state ?? "idle";
    if (on && (s === "idle" || s === "asleep")) setState(threadId, "listening", "active now");
    if (!on && s === "listening") setState(threadId, "idle", "active now");
  },
  async upload(file) {
    await wait(300);
    const a = { id: F.uid("f"), url: URL.createObjectURL(file), name: file.name, mime: file.type };
    uploads[a.id] = a;
    return a;
  },
  async react(messageId, emoji) {
    await wait(60);
    const m = findMessage(messageId);
    if (!m) return;
    const mine = m.reactions.find((r) => r.by === "user");
    const others = m.reactions.filter((r) => r.by !== "user");
    m.reactions = mine?.emoji === emoji ? others : [...others, { emoji, by: "user" } as Reaction];
    emit({ type: "reaction", data: { messageId, threadId: m.threadId, reactions: m.reactions } });
  },
  async approve(approvalId, decision) {
    await wait();
    const m = Object.values(db.messages)
      .flat()
      .find((x) => x.approval?.approvalId === approvalId);
    if (!m) throw new ApiError(404, "That approval expired");
    decide(m, decision === "once" ? "allowed" : decision === "always" ? "always" : "denied");
  },

  async schedules() {
    await wait();
    return structuredClone(db.schedules);
  },
  async patchSchedule(id, patch) {
    await wait();
    const s = db.schedules.find((x) => x.id === id);
    if (s) Object.assign(s, patch, { nextAt: patch.enabled ? Date.now() + 20 * F.HOUR : null });
  },
  async deleteSchedule(id) {
    await wait();
    db.schedules = db.schedules.filter((x) => x.id !== id);
  },
  async runSchedule(id) {
    await wait();
    const s = db.schedules.find((x) => x.id === id);
    if (s) s.lastAt = Date.now();
  },

  async runs(status, limit = 30) {
    await wait();
    const active = new Set(["queued", "running", "waiting"]);
    return structuredClone(db.runs.filter((r) => (status === "active") === active.has(r.status)).slice(0, limit));
  },
  async run(id) {
    await wait();
    const run = db.runs.find((r) => r.id === id) ?? db.runs[0];
    return structuredClone({ run, log: F.runLog(id) });
  },

  async today() {
    await wait();
    return structuredClone({
      ...db.today,
      cards: db.today.cards.filter((c) => !c.dismissed),
    });
  },
  async dismissCard(id) {
    await wait();
    const c = db.today.cards.find((x) => x.id === id);
    if (c) c.dismissed = true;
  },
  async dismissIdea(id) {
    await wait();
    db.today.ideas = db.today.ideas.filter((x) => x.id !== id);
  },
  async doIdea(id) {
    const idea = db.today.ideas.find((x) => x.id === id);
    db.today.ideas = db.today.ideas.filter((x) => x.id !== id);
    return mockApi.send(F.MAIN, { text: idea?.prompt ?? "Let's do it" });
  },

  async goals() {
    await wait();
    return structuredClone(db.goals);
  },
  async patchGoal(id, patch) {
    await wait();
    const g = db.goals.find((x) => x.id === id);
    if (!g) return;
    Object.assign(g, patch);
    if (patch.plan) g.progress = patch.plan.filter((s) => s.done).length / Math.max(1, patch.plan.length);
    emit({ type: "goals.updated", data: {} });
  },
  async deleteGoal(id) {
    await wait();
    db.goals = db.goals.filter((x) => x.id !== id);
  },

  async library() {
    await wait();
    return structuredClone(db.library);
  },
  libraryRawUrl(path) {
    const item = db.library.find((x) => x.path === path);
    if (item?.url) return item.url;
    if (!blobUrls[path]) {
      const text = F.libraryText[path] ?? "This is a mock file.";
      blobUrls[path] = URL.createObjectURL(new Blob([text], { type: item?.mime ?? "text/plain" }));
    }
    return blobUrls[path];
  },
  async libraryText(path) {
    await wait();
    return F.libraryText[path] ?? "";
  },

  async memory() {
    await wait();
    return { ...db.memory };
  },
  async putMemory(name, content) {
    await wait(300);
    db.memory[name] = content;
  },

  async settings() {
    await wait();
    return structuredClone(db.settings);
  },
  async patchSettings(patch) {
    await wait();
    Object.assign(db.settings, patch);
    return structuredClone(db.settings);
  },
  async patchAgent(patch) {
    await wait();
    Object.assign(db.agent, patch);
    return structuredClone(db.agent);
  },
  async usage() {
    await wait();
    return F.usage();
  },

  async pushSubscribe() {
    await wait();
  },
  async pushTest() {
    await wait();
  },
};

export const mockStream: KinStream = {
  connect(onEvent, onStatus) {
    onStatus("connecting");
    const t = setTimeout(() => onStatus("open"), 120);
    listeners.add(onEvent);
    return () => {
      clearTimeout(t);
      listeners.delete(onEvent);
    };
  },
};

/** Hooks for screenshots and poking at the UI from the console. */
declare global {
  interface Window {
    __kinMock?: {
      setState: (state: AgentState, status?: string, threadId?: string) => void;
      say: (text: string, threadId?: string) => void;
      react: (messageId: string, emoji: string) => void;
      lastUserMessageId: () => string | undefined;
    };
  }
}

window.__kinMock = {
  setState: (state, status = `${state}…`, threadId = F.MAIN) => setState(threadId, state, status),
  say: (text, threadId = F.MAIN) => put(agentMsg(threadId, text), true),
  react: (messageId, emoji) => {
    const m = findMessage(messageId);
    if (!m) return;
    m.reactions = [...m.reactions.filter((r) => r.by !== "agent"), { emoji, by: "agent" }];
    emit({ type: "reaction", data: { messageId, threadId: m.threadId, reactions: m.reactions } });
  },
  lastUserMessageId: () => [...(db.messages[F.MAIN] ?? [])].reverse().find((m) => m.role === "user")?.id,
};
