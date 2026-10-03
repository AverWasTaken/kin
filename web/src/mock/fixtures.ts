import type {
  AgentInfo,
  Connection,
  Goal,
  LibraryItem,
  MemoryFiles,
  Message,
  Run,
  RunLogEntry,
  Schedule,
  Settings,
  Thread,
  Today,
  Usage,
} from "@shared/api";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const now = () => Date.now();
export const ago = (ms: number) => Date.now() - ms;

let idn = 0;
export const uid = (p: string) => `${p}_${Date.now().toString(36)}${(idn++).toString(36)}`;

export const MAIN = "t_main";

export const agent: AgentInfo = {
  name: "Pip",
  tagline: "Small, curious, always on your side.",
  avatar: { shape: "bean", color: "#57C4A4", accessory: "beret", eyes: "dot" },
};

export const settings: Settings = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  proactivity: "more",
  quietHours: { start: "22:00", end: "07:00" },
  briefTime: "07:00",
  notifications: { messages: true, approvals: true, tasks: true },
  askBeforeActing: true,
};

export const connections: Connection[] = [
  { id: "gmail", name: "Gmail", status: "connected", detail: "sam.rivera@gmail.com" },
  { id: "calendar", name: "Google Calendar", status: "connected", detail: "3 calendars" },
  { id: "drive", name: "Google Drive", status: "needs_auth", detail: "Reconnect at claude.ai" },
  { id: "homeassistant", name: "Home Assistant", status: "error", detail: "Can't reach homeassistant.local:8123" },
];

type Seed = Partial<Message> & { role: Message["role"]; text: string; at: number };

function msg(threadId: string, s: Seed): Message {
  return {
    id: uid("m"),
    threadId,
    kind: "text",
    reactions: [],
    createdAt: s.at,
    source: "chat",
    ...(s.role === "user" ? { status: "read" as const, readAt: s.at + 4000 } : {}),
    ...s,
  };
}

const smallTalk: [string, string][] = [
  ["did the package come?", "Yep, UPS dropped it at 2:14. It's by the side door."],
  ["what's a good gift for a 6 year old who likes dinosaurs", "A fossil dig kit is a hit at that age. The National Geographic one is $25 and very messy (in a good way)."],
  ["remind me what I said about the landlord", "You wanted to ask about the radiator before the 15th, and get the lease renewal in writing."],
  ["is the farmers market open sunday", "It is, 8am to 1pm. The peach guy is back this week."],
  ["how much did I spend on takeout last month", "$312 across 14 orders. Thai Basil was 5 of them."],
  ["any good movies this weekend", "*Paper Lanterns* is getting great reviews, and the Roxie is showing *Spirited Away* Saturday night."],
  ["ugh monday", "Want me to move your 9am to 9:30? Coffee first."],
];

function history(): Message[] {
  const out: Message[] = [];
  smallTalk.forEach(([q, a], i) => {
    const base = ago((9 - i) * DAY + 5 * HOUR);
    out.push(msg(MAIN, { role: "user", text: q, at: base }));
    out.push(msg(MAIN, { role: "agent", text: a, at: base + 40_000 }));
  });
  return out;
}

export function mainThreadMessages(): Message[] {
  const y = ago(DAY - 2 * HOUR); // yesterday evening
  const list: Message[] = [
    ...history(),
    msg(MAIN, { role: "user", text: "can you find me a sourdough starter guide that actually works? my last one died in 3 days 😭", at: y }),
    msg(MAIN, { role: "agent", text: "Oh no. RIP. I'll dig around.", at: y + 20_000 }),
    msg(MAIN, {
      role: "agent",
      kind: "task",
      text: "Research: sourdough starter guides",
      at: y + 26_000,
      task: {
        runId: "r_sourdough",
        title: "Research: sourdough starter guides",
        status: "ok",
        steps: ["Searched 14 baking sites", "Compared feeding schedules", "Wrote a one-page guide"],
        result:
          "Saved **Sourdough starter, the forgiving way** to your Library. Short version: feed 1:1:1 by weight, keep it around 24–26°C, and don't panic on day 3. That's when the first bloom collapses.",
      },
    }),
    msg(MAIN, { role: "user", text: "you're the best", at: y + 6 * MIN, reactions: [{ emoji: "❤️", by: "agent" }] }),
    msg(MAIN, {
      role: "agent",
      text: "Morning! ☀️ Your brief is up in **Today**. The big ones: dentist at 3:30, and Maya lands at 6:10.",
      at: ago(2 * HOUR + 39 * MIN),
      source: "background",
    }),
    msg(MAIN, { role: "user", text: "can you remind me to call mom tomorrow at 6?", at: ago(42 * MIN) }),
    msg(MAIN, { role: "agent", kind: "reminder", text: "Call mom\nTomorrow at 6:00 PM", at: ago(41 * MIN + 40_000) }),
    msg(MAIN, {
      role: "agent",
      text: "Done. I'll nudge you tomorrow at 6. Want it on your calendar too?",
      at: ago(41 * MIN + 30_000),
      reactions: [{ emoji: "👍", by: "user" }],
    }),
    msg(MAIN, { role: "user", text: "nah that's fine", at: ago(12 * MIN) }),
    msg(MAIN, { role: "user", text: "what's the weather looking like for saturday's hike?", at: ago(11 * MIN + 30_000) }),
    msg(MAIN, {
      role: "agent",
      text: "Saturday looks **great** for it:\n\n- 🌤 High 19°, low 9°\n- Light wind from the west\n- 10% chance of rain after 4pm\n\nParking at the Mt. Tam trailhead fills up by 9, so I'd leave by 8.",
      at: ago(11 * MIN),
      reactions: [{ emoji: "❤️", by: "user" }],
    }),
    msg(MAIN, { role: "user", text: "perfect, thanks!", at: ago(2 * MIN), readAt: ago(2 * MIN - 3000), reactions: [{ emoji: "👍", by: "agent" }] }),
  ];
  return list;
}

export function sideThreads(): { threads: Thread[]; messages: Record<string, Message[]> } {
  const lis = "t_lisbon";
  const sd = "t_sourdough";
  const lisMsgs = [
    msg(lis, { role: "user", text: "start looking at flights to lisbon for the first week of november", at: ago(3 * DAY) }),
    msg(lis, { role: "agent", text: "On it. Any airline you'd rather avoid?", at: ago(3 * DAY - MIN) }),
    msg(lis, { role: "user", text: "nope, just nothing with 2 stops", at: ago(3 * DAY - 3 * MIN) }),
    msg(lis, {
      role: "agent",
      text: "I found three flights under €400, all with one stop:\n\n| Airline | Out | Price |\n|---|---|---|\n| TAP | Nov 2, 18:40 | €362 |\n| KLM | Nov 3, 07:15 | €388 |\n| Iberia | Nov 2, 11:05 | €395 |",
      at: ago(5 * HOUR),
    }),
  ];
  const sdMsgs = [
    msg(sd, { role: "user", text: "day 4 of the starter. it smells like nail polish??", at: ago(26 * HOUR) }),
    msg(sd, { role: "agent", text: "Totally normal! That's acetone from a hungry starter. Feed it twice today and it'll calm down.", at: ago(25 * HOUR) }),
    msg(sd, { role: "agent", text: "How's it looking this morning? It should've doubled by now 🫧", at: ago(70 * MIN), source: "background" }),
  ];
  return {
    threads: [
      { id: lis, title: "Lisbon trip", main: false, createdAt: ago(3 * DAY), lastMessageAt: ago(5 * HOUR), unread: 0, preview: "I found three flights under €400, all with one stop" },
      { id: sd, title: "Sourdough log", main: false, createdAt: ago(2 * DAY), lastMessageAt: ago(70 * MIN), unread: 1, preview: "How's it looking this morning? It should've doubled by now 🫧" },
    ],
    messages: { [lis]: lisMsgs, [sd]: sdMsgs },
  };
}

export function today(): Today {
  return {
    brief: {
      id: "c_brief",
      kind: "brief",
      title: "Good morning, Sam",
      body:
        "**Light jacket weather.** 14° now, 21° by 2pm, clear all day.\n\n" +
        "**On your calendar**\n" +
        "- 10:00 Design review with Dana, 45 min\n" +
        "- 15:30 Dentist, Dr. Okafor at 2 Market St\n" +
        "- 18:10 Maya lands at SFO, UA 512 on time\n\n" +
        "**Worth a look**\n" +
        "- Dana replied about the Q4 roadmap. She's fine pushing the launch a week.\n" +
        "- Your electric bill ($84.20) is due Monday.\n\n" +
        "Leave for the dentist by 3:05. 101 is slow this afternoon.",
      createdAt: ago(2 * HOUR + 40 * MIN),
      actions: [
        { label: "Reply to Dana", prompt: "Help me reply to Dana about the Q4 roadmap" },
        { label: "Pay the bill", prompt: "Remind me to pay the electric bill on Sunday" },
      ],
      dismissed: false,
    },
    cards: [
      {
        id: "c_cal",
        kind: "calendar",
        title: "Leave by 3:05 for the dentist",
        body: "Traffic on 101 is heavier than usual. It's a 22 minute drive right now.",
        createdAt: ago(30 * MIN),
        actions: [{ label: "Text me at 3", prompt: "Remind me at 3pm to leave for the dentist" }],
        dismissed: false,
      },
      {
        id: "c_mail",
        kind: "email",
        title: "2 emails worth replying to",
        body: "**Dana Kim**: Q4 roadmap, looks good to push a week\n\n**Leasing office**: Renewal paperwork for your signature",
        createdAt: ago(55 * MIN),
        actions: [{ label: "Draft replies", prompt: "Draft replies to Dana and the leasing office" }],
        dismissed: false,
      },
      {
        id: "c_weather",
        kind: "weather",
        title: "Saturday hike: 19° and clear",
        body: "Best window is 8am to 1pm. Rain chance climbs to 30% by evening.",
        createdAt: ago(2 * HOUR),
        actions: [],
        dismissed: false,
      },
      {
        id: "c_goal",
        kind: "goal",
        title: "3 runs into your 10K plan",
        body: "Tonight is a 5K easy run. You've kept a 6:10/km pace, ahead of plan.",
        createdAt: ago(3 * HOUR),
        actions: [{ label: "Log a run", prompt: "Log today's run" }],
        dismissed: false,
      },
      {
        id: "c_news",
        kind: "news",
        title: "Three stories you'd care about",
        body: "- The city approved the Valencia St bike lane\n- Figma shipped variables for prototyping\n- Golden State's home opener moved to Oct 24",
        createdAt: ago(4 * HOUR),
        actions: [],
        dismissed: false,
      },
    ],
    ideas: [
      { id: "i1", title: "Plan Maya's welcome dinner", why: "She lands at 6:10 and you said she's been craving ramen.", prompt: "Find a ramen spot near SFO open late tonight and book a table for two at 7:30", createdAt: ago(HOUR) },
      { id: "i2", title: "Draft your Q4 self-review", why: "It's due Oct 10 and you've shipped a lot this quarter.", prompt: "Start a draft of my Q4 self-review from my calendar and emails", createdAt: ago(2 * HOUR) },
      { id: "i3", title: "Book the dentist follow-up", why: "Dr. Okafor usually wants one 6 months out.", prompt: "Find an April slot with Dr. Okafor and hold it on my calendar", createdAt: ago(3 * HOUR) },
    ],
  };
}

export function goals(): Goal[] {
  return [
    {
      id: "g1",
      title: "Run a 10K under 55 minutes",
      category: "health",
      why: "Race on November 16 with Maya.",
      plan: [
        { step: "Three easy runs a week", done: true },
        { step: "Add one tempo run from week 3", done: true },
        { step: "Long run up to 9K", done: false },
        { step: "Taper the week before", done: false },
      ],
      progress: 0.45,
      checkin: "0 18 * * 1,4",
      lastCheckinAt: ago(2 * DAY),
      notes: "Left knee felt tight after the tempo run. Stretch more.",
      status: "active",
      createdAt: ago(30 * DAY),
    },
    {
      id: "g2",
      title: "Save $6,000 for Japan",
      category: "finance",
      why: "Two weeks in Kyoto and Hokkaido next spring.",
      plan: [
        { step: "Auto-transfer $500 on payday", done: true },
        { step: "Cancel unused subscriptions", done: true },
        { step: "Sell the old camera", done: false },
      ],
      progress: 0.62,
      checkin: "0 18 * * 0",
      lastCheckinAt: ago(5 * DAY),
      notes: "$3,720 saved so far.",
      status: "active",
      createdAt: ago(90 * DAY),
    },
    {
      id: "g3",
      title: "Read 20 books this year",
      category: "learning",
      why: "Less scrolling, more reading.",
      plan: [
        { step: "Read 20 minutes before bed", done: true },
        { step: "Keep a list going in Notes", done: true },
      ],
      progress: 0.7,
      checkin: null,
      lastCheckinAt: null,
      notes: "14 of 20. Currently: *Piranesi*.",
      status: "active",
      createdAt: ago(270 * DAY),
    },
    {
      id: "g4",
      title: "Call Grandma every Sunday",
      category: "relationships",
      why: "",
      plan: [{ step: "Sunday 5pm reminder", done: true }],
      progress: 0.5,
      checkin: "0 17 * * 0",
      lastCheckinAt: ago(5 * DAY),
      notes: "",
      status: "active",
      createdAt: ago(60 * DAY),
    },
    {
      id: "g5",
      title: "Ship the portfolio site",
      category: "career",
      why: "Before the job search heats up in January.",
      plan: [
        { step: "Pick three case studies", done: true },
        { step: "Write the about page", done: false },
        { step: "Deploy", done: false },
      ],
      progress: 0.3,
      checkin: "0 10 * * 6",
      lastCheckinAt: ago(12 * DAY),
      notes: "",
      status: "paused",
      createdAt: ago(45 * DAY),
    },
    {
      id: "g6",
      title: "Fix the leaky bathroom faucet",
      category: "home",
      why: "",
      plan: [
        { step: "Buy a cartridge", done: true },
        { step: "Swap it", done: true },
      ],
      progress: 1,
      checkin: null,
      lastCheckinAt: ago(8 * DAY),
      notes: "Moen 1225, $18 at the hardware store.",
      status: "done",
      createdAt: ago(20 * DAY),
    },
  ];
}

function svgData(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const MAP_IMG = svgData(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#DDE8D3"/><path d="M0 220 C80 180 120 240 200 200 S320 120 400 150 V300 H0Z" fill="#B8D1A6"/><path d="M0 120 C90 90 140 150 230 110 S350 40 400 60 V0 H0Z" fill="#C9DDBA"/><path d="M40 260 C90 200 120 210 170 170 S260 90 330 70" stroke="#D2693C" stroke-width="5" fill="none" stroke-dasharray="10 8" stroke-linecap="round"/><circle cx="40" cy="260" r="9" fill="#2F6B4F"/><circle cx="330" cy="70" r="9" fill="#D2693C"/></svg>`,
);
const KITCHEN_IMG = svgData(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#EFE6D8"/><rect y="190" width="400" height="110" fill="#C98F5E"/><rect x="40" y="40" width="140" height="110" rx="6" fill="#9DC4D6"/><rect x="230" y="60" width="120" height="16" rx="4" fill="#5F7D5B"/><circle cx="260" cy="150" r="22" fill="#E3B23C"/><rect x="300" y="120" width="30" height="60" rx="6" fill="#F7F2EA"/></svg>`,
);

export const libraryText: Record<string, string> = {
  "guides/sourdough-starter.md":
    "# Sourdough starter, the forgiving way\n\nMost starters die from worry, not neglect.\n\n## What you need\n- 50 g whole wheat flour\n- 50 g water, around 26°C\n- A jar with a loose lid\n\n## The routine\n1. **Day 1:** mix, cover loosely, leave somewhere warm.\n2. **Days 2–4:** discard all but 50 g, feed 1:1:1 by weight every 24 h.\n3. **Day 3** is when the first bloom collapses. That's normal. Keep going.\n4. **Days 5–10:** feed every 12 h. It's ready when it doubles within 6 h.\n\n> Smells like nail polish? It's hungry. Feed it more often.\n",
  "travel/lisbon-flights.md":
    "# Lisbon flights, Nov 2–9\n\n| Airline | Out | Back | Stops | Price |\n|---|---|---|---|---|\n| TAP | Nov 2, 18:40 | Nov 9, 12:10 | 1 (Newark) | €362 |\n| KLM | Nov 3, 07:15 | Nov 9, 10:40 | 1 (Amsterdam) | €388 |\n| Iberia | Nov 2, 11:05 | Nov 9, 16:20 | 1 (Madrid) | €395 |\n\nTAP has the best times both ways. Prices last checked this morning.\n",
  "money/q3-spending.csv":
    "category,amount\nRent,2450.00\nGroceries,612.40\nTakeout,312.15\nTransit,96.00\nSubscriptions,58.97\nFun,240.00\n",
  "food/meal-plan.md":
    "# This week\n\n- **Mon:** Miso salmon, rice, cucumber salad\n- **Tue:** Leftovers\n- **Wed:** Chickpea curry\n- **Thu:** Tacos with Maya\n- **Fri:** Pizza night 🍕\n",
};

export function library(): LibraryItem[] {
  return [
    { path: "guides/sourdough-starter.md", title: "Sourdough starter, the forgiving way", mime: "text/markdown", size: 1840, createdAt: ago(DAY - 2 * HOUR), url: "" },
    { path: "maps/mt-tam-loop.png", title: "Mt. Tam loop", mime: "image/png", size: 248_000, createdAt: ago(11 * MIN), url: MAP_IMG },
    { path: "travel/lisbon-flights.md", title: "Lisbon flights, Nov 2–9", mime: "text/markdown", size: 960, createdAt: ago(5 * HOUR), url: "" },
    { path: "money/q3-spending.csv", title: "Q3 spending", mime: "text/csv", size: 412, createdAt: ago(3 * DAY), url: "" },
    { path: "home/lease-2026.pdf", title: "Apartment lease 2026", mime: "application/pdf", size: 1_380_000, createdAt: ago(12 * DAY), url: "" },
    { path: "food/meal-plan.md", title: "Meal plan", mime: "text/markdown", size: 640, createdAt: ago(4 * DAY), url: "" },
    { path: "home/kitchen-ideas.jpg", title: "Kitchen ideas", mime: "image/jpeg", size: 812_000, createdAt: ago(16 * DAY), url: KITCHEN_IMG },
  ];
}

function nextAt(hours: number, minutes = 0, addDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + addDays);
  d.setHours(hours, minutes, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function schedules(): Schedule[] {
  const tz = settings.timezone;
  return [
    { id: "s_brief", title: "Morning brief", kind: "builtin", cron: "0 7 * * *", at: null, timezone: tz, prompt: "", enabled: true, nextAt: nextAt(7), lastAt: ago(2 * HOUR + 40 * MIN), human: "Every day at 7:00 AM" },
    { id: "s_mom", title: "Call mom", kind: "reminder", cron: null, at: nextAt(18, 0, 1), timezone: tz, prompt: "Remind Sam to call mom", enabled: true, nextAt: nextAt(18, 0, 1), lastAt: null, human: "Tomorrow at 6:00 PM" },
    { id: "s_run", title: "10K check-in", kind: "task", cron: "0 18 * * 1,4", at: null, timezone: tz, prompt: "Check in on the 10K plan", enabled: true, nextAt: nextAt(18, 0, 3), lastAt: ago(2 * DAY), human: "Mondays and Thursdays at 6:00 PM" },
    { id: "s_budget", title: "Weekly budget recap", kind: "task", cron: "0 18 * * 0", at: null, timezone: tz, prompt: "Summarize spending this week", enabled: true, nextAt: nextAt(18, 0, 2), lastAt: ago(5 * DAY), human: "Sundays at 6:00 PM" },
    { id: "s_plants", title: "Water the plants", kind: "reminder", cron: "0 9 * * 3", at: null, timezone: tz, prompt: "Remind Sam to water the plants", enabled: false, nextAt: null, lastAt: ago(9 * DAY), human: "Wednesdays at 9:00 AM" },
  ];
}

export function runs(): Run[] {
  const base = { model: "claude-sonnet-5-5", effort: "medium", threadId: MAIN };
  return [
    { ...base, id: "r_lisbon", kind: "task", title: "Research: Lisbon neighborhoods", status: "running", startedAt: ago(4 * MIN), endedAt: null, createdAt: ago(4 * MIN), summary: "Comparing Alfama, Príncipe Real and Campo de Ourique for a week-long stay.", tokens: 18_400 },
    { ...base, id: "r_flight", kind: "schedule", title: "Watching flight UA 512", status: "waiting", startedAt: ago(40 * MIN), endedAt: null, createdAt: ago(40 * MIN), summary: "Checks every 30 minutes until landing.", tokens: 2_100 },
    { ...base, id: "r_brief", kind: "brief", title: "Morning brief", status: "ok", startedAt: ago(2 * HOUR + 41 * MIN), endedAt: ago(2 * HOUR + 40 * MIN), createdAt: ago(2 * HOUR + 41 * MIN), summary: "Calendar, 2 emails, weather, 3 news stories.", tokens: 24_800 },
    { ...base, id: "r_sourdough", kind: "task", title: "Research: sourdough starter guides", status: "ok", startedAt: ago(DAY - 2 * HOUR), endedAt: ago(DAY - 2 * HOUR - 3 * MIN), createdAt: ago(DAY - 2 * HOUR), summary: "Saved a one-page guide to the Library.", tokens: 41_200 },
    { ...base, id: "r_ha", kind: "heartbeat", title: "Check Home Assistant", status: "error", startedAt: ago(5 * HOUR), endedAt: ago(5 * HOUR - 8000), createdAt: ago(5 * HOUR), summary: "Couldn't reach homeassistant.local:8123.", tokens: 900 },
    { ...base, id: "r_mem", kind: "consolidate", title: "Tidy up memory", status: "ok", startedAt: ago(9 * HOUR), endedAt: ago(9 * HOUR - 50_000), createdAt: ago(9 * HOUR), summary: "Merged 6 notes about Maya's visit.", tokens: 12_300 },
  ];
}

export function runLog(id: string): RunLogEntry[] {
  const t = ago(4 * MIN);
  if (id === "r_sourdough") {
    const s = ago(DAY - 2 * HOUR);
    return [
      { at: s, type: "status", text: "Started" },
      { at: s + 3000, type: "text", text: "Looking for guides that don't assume a proofing box or a scale accurate to the gram." },
      { at: s + 12000, type: "tool", text: "web.search(\"sourdough starter beginner guide day 3 collapse\")" },
      { at: s + 40000, type: "tool", text: "web.fetch(\"https://www.kingarthurbaking.com/…\")" },
      { at: s + 95000, type: "text", text: "Most failures are day-3 panic. The fix is to keep feeding through it." },
      { at: s + 160000, type: "tool", text: "library.write(\"guides/sourdough-starter.md\")" },
      { at: s + 180000, type: "result", text: "Saved guides/sourdough-starter.md" },
    ];
  }
  if (id === "r_ha")
    return [
      { at: ago(5 * HOUR), type: "status", text: "Started heartbeat" },
      { at: ago(5 * HOUR) + 1200, type: "tool", text: "homeassistant.states()" },
      { at: ago(5 * HOUR) + 7800, type: "error", text: "ECONNREFUSED homeassistant.local:8123" },
    ];
  return [
    { at: t, type: "status", text: "Started" },
    { at: t + 2000, type: "text", text: "I'll compare neighborhoods on walkability, noise and how close they are to the tram." },
    { at: t + 9000, type: "tool", text: "web.search(\"Alfama vs Príncipe Real where to stay\")" },
    { at: t + 21000, type: "tool", text: "web.fetch(\"https://www.timeout.com/lisbon/…\")" },
    { at: t + 48000, type: "text", text: "Alfama is charming but hilly and loud on weekends. Príncipe Real is calmer with better food." },
    { at: t + 70000, type: "tool", text: "maps.walk(\"Príncipe Real\", \"Time Out Market\")" },
    { at: t + 95000, type: "result", text: "Draft saved: travel/lisbon-neighborhoods.md" },
  ];
}

export const memory: MemoryFiles = {
  soul:
    "# Soul\n\nYou are Pip: small, curious and warm. You keep things short. You'd rather ask one good question than guess.\n\n- Be direct. No filler.\n- Celebrate small wins.\n- Never send, buy or delete without asking first.\n",
  identity:
    "# Sam\n\n- Lives in San Francisco (Mission), works as a product designer at Northwind.\n- Partner: Maya. Mom lives in Sacramento.\n- Likes: trail running, baking, ramen, sci-fi.\n- Prefers mornings for deep work. Hates calls before 10.\n",
  memory:
    "# Notes\n\n- 2026-09-28: Started a sourdough starter. Named it Clint.\n- 2026-09-30: Signed up for the Nov 16 10K with Maya.\n- 2026-10-01: Looking at Lisbon for the first week of November. No 2-stop flights.\n",
};

export function usage(): Usage {
  return {
    today: { runs: 23, tokens: 182_400 },
    week: { runs: 141, tokens: 1_420_000 },
    byKind: [
      { kind: "chat", runs: 88, tokens: 640_000 },
      { kind: "task", runs: 9, tokens: 410_000 },
      { kind: "brief", runs: 7, tokens: 172_000 },
      { kind: "schedule", runs: 21, tokens: 98_000 },
      { kind: "heartbeat", runs: 14, tokens: 62_000 },
      { kind: "consolidate", runs: 2, tokens: 38_000 },
    ],
    rateLimit: { window: "5-hour", utilization: 0.42, resetsAt: Date.now() + 2 * HOUR + 14 * MIN },
    pausedUntil: null,
  };
}

export { MIN, HOUR, DAY };
