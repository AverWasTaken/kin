// Screenshots of every screen in mock mode, light and dark, at iPhone 15 size.
// Run: npm run shots   (writes web/screenshots/*.png)
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";
import { createServer } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "screenshots");
mkdirSync(outDir, { recursive: true });

const only = process.argv.slice(2);
const server = await createServer({ root, server: { port: 5199, strictPort: true }, logLevel: "error" });
await server.listen();
const base = "http://localhost:5199";

const iphone = devices["iPhone 15"];
const browser = await chromium.launch();

// A standalone PWA on an iPhone 15: full 393x852 with the notch and home indicator insets.
const chrome = (dark) => `
  :root { --safe-t: 54px !important; --safe-b: 34px !important; }
  #fake-status { position: fixed; top: 0; left: 0; right: 0; height: 54px; z-index: 9999; pointer-events: none;
    display: flex; align-items: center; justify-content: space-between; padding: 6px 34px 0 52px;
    font: 600 17px -apple-system, "Segoe UI", system-ui; color: ${dark ? "#fff" : "#000"}; }
  #fake-status .island { position: absolute; left: 50%; top: 11px; width: 124px; height: 36px; margin-left: -62px; border-radius: 20px; background: #000; }
  #fake-home { position: fixed; bottom: 8px; left: 50%; width: 140px; height: 5px; margin-left: -70px; border-radius: 3px; z-index: 9999;
    background: ${dark ? "#fff" : "#000"}; pointer-events: none; }
`;

async function decorate(page, dark) {
  await page.addStyleTag({ content: chrome(dark) });
  await page.evaluate(() => {
    if (document.getElementById("fake-status")) return;
    const s = document.createElement("div");
    s.id = "fake-status";
    s.innerHTML = `<span>9:41</span><span class="island"></span><span style="display:flex;gap:6px;align-items:center">
      <svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor"/><rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor"/></svg>
      <svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="18" height="9" rx="2" fill="currentColor"/><rect x="25" y="4.5" width="1.5" height="4" rx=".75" fill="currentColor" opacity=".4"/></svg></span>`;
    document.body.appendChild(s);
    const h = document.createElement("div");
    h.id = "fake-home";
    document.body.appendChild(h);
  });
}

async function open(scheme, query = "") {
  const ctx = await browser.newContext({
    ...iphone,
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date("2026-10-02T09:41:00"));
  await page.goto(`${base}/?mock=1${query}`);
  await decorate(page, scheme === "dark");
  return { ctx, page };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name, scheme) {
  const file = join(outDir, `${name}-${scheme}.png`);
  await page.screenshot({ path: file });
  console.log("  ", file);
}

async function send(page, text) {
  await page.fill(".composer textarea", text);
  await page.click(".send-btn");
}

const scenes = {
  async onboarding(scheme) {
    const { ctx, page } = await open(scheme, "&fresh=1");
    await page.waitForSelector(".ob-name");
    await page.fill(".ob-name", "Pip");
    await wait(1400);
    await shot(page, "01-onboarding-name", scheme);
    await page.click(".ob-foot .btn");
    await wait(700);
    await page.click('.cz-opt[aria-label="Beret"]');
    await wait(1200);
    await shot(page, "02-onboarding-look", scheme);
    await ctx.close();
  },
  async signin(scheme) {
    const { ctx, page } = await open(scheme, "&signedout=1");
    await page.waitForSelector(".signin-card");
    await wait(700);
    await shot(page, "00-signin", scheme);
    await ctx.close();
  },
  async chat(scheme) {
    const { ctx, page } = await open(scheme);
    await page.waitForSelector(".bubble");
    await wait(900);
    await shot(page, "03-chat", scheme);
    await page.evaluate(() => window.__kinMock.setState("typing", "typing…"));
    await wait(900);
    await shot(page, "04-chat-typing", scheme);
    await page.evaluate(() => window.__kinMock.setState("idle", "active now"));
    await wait(400);
    // Long-press menu on an agent bubble (right-click opens the same menu).
    const target = page.locator(".bubble.agent", { hasText: "Parking at the Mt. Tam" });
    await target.click({ button: "right" });
    await wait(700);
    await shot(page, "05-reaction-menu", scheme);
    await page.click('.tapback.more');
    await wait(600);
    await shot(page, "05b-emoji-picker", scheme);
    await ctx.close();
  },
  async cards(scheme) {
    const { ctx, page } = await open(scheme);
    await page.waitForSelector(".bubble");
    await wait(500);
    await send(page, "can you research the best e-bikes under $2k?");
    await page.waitForSelector(".task-card", { timeout: 15000 });
    await wait(3200);
    await send(page, "and email Dana that I'll be 10 min late");
    await page.waitForSelector(".approval-card", { timeout: 15000 });
    await wait(1500);
    await shot(page, "06-approval-task", scheme);
    await page.click(".drawer-scrim").catch(() => {});
    await ctx.close();
  },
  async drawer(scheme) {
    const { ctx, page } = await open(scheme);
    await page.waitForSelector(".bubble");
    await page.click(".head-left");
    await wait(700);
    await shot(page, "07-chats-drawer", scheme);
    await ctx.close();
  },
  async today(scheme) {
    const { ctx, page } = await open(scheme);
    await page.waitForSelector(".bubble");
    await page.click('.tab:has-text("Today")');
    await page.waitForSelector(".brief");
    await wait(900);
    await shot(page, "08-today", scheme);
    await page.evaluate(() => document.querySelector(".tab-panel:not([hidden]) .scroll")?.scrollBy(0, 640));
    await wait(500);
    await shot(page, "08b-today-feed", scheme);
    await ctx.close();
  },
  async goals(scheme) {
    const { ctx, page } = await open(scheme);
    await page.waitForSelector(".bubble");
    await page.click('.tab:has-text("Goals")');
    await page.waitForSelector(".goal-row");
    await wait(1200);
    await shot(page, "09-goals", scheme);
    await page.click(".goal-row >> nth=0");
    await wait(1200);
    await shot(page, "09b-goal-sheet", scheme);
    await ctx.close();
  },
  async library(scheme) {
    const { ctx, page } = await open(scheme);
    await page.waitForSelector(".bubble");
    await page.click('.tab:has-text("Library")');
    await page.waitForSelector(".tile");
    await wait(900);
    await shot(page, "10-library", scheme);
    await page.click(".tile >> nth=0");
    await wait(1200);
    await shot(page, "10b-library-viewer", scheme);
    await ctx.close();
  },
  async profile(scheme) {
    const { ctx, page } = await open(scheme);
    await page.waitForSelector(".bubble");
    await page.click(".head-center");
    await page.waitForSelector(".hero");
    await wait(1300);
    await shot(page, "11-profile", scheme);
    await page.evaluate(() => document.querySelector(".sheet-body")?.scrollBy(0, 560));
    await wait(500);
    await shot(page, "11b-profile-activity", scheme);
    await page.evaluate(() => document.querySelector(".sheet-body")?.scrollBy(0, 1000));
    await wait(500);
    await shot(page, "11c-profile-settings", scheme);
    await page.evaluate(() => document.querySelector(".sheet-body")?.scrollBy(0, 2000));
    await wait(500);
    await shot(page, "11d-profile-usage", scheme);
    await ctx.close();
  },
  async details(scheme) {
    const { ctx, page } = await open(scheme);
    await page.waitForSelector(".bubble");
    await page.evaluate(() => document.querySelector(".thread-scroll")?.scrollBy(0, -700));
    await wait(400);
    await page.click(".task-card");
    await page.waitForSelector(".run-detail");
    await wait(1100);
    await shot(page, "12-run-detail", scheme);
    await page.keyboard.press("Escape");
    await wait(600);
    await page.click(".head-center");
    await page.waitForSelector(".hero");
    await wait(700);
    await page.click('button.row:has-text("Soul")');
    await page.waitForSelector(".mem-text");
    await wait(1000);
    await shot(page, "13-memory-editor", scheme);
    await ctx.close();
  },
  async onboardingLater(scheme) {
    const { ctx, page } = await open(scheme, "&fresh=1");
    await page.waitForSelector(".ob-name");
    await page.fill(".ob-name", "Pip");
    await page.click(".ob-foot .btn");
    await wait(500);
    await page.click(".ob-foot .btn");
    await wait(500);
    await page.fill(".ob-form input >> nth=0", "Sam");
    await page.fill(".ob-form input >> nth=1", "San Francisco");
    await wait(900);
    await shot(page, "02b-onboarding-about", scheme);
    await page.click(".ob-foot .btn");
    await wait(900);
    await shot(page, "02c-onboarding-connections", scheme);
    await page.click(".ob-foot .btn");
    await wait(900);
    await shot(page, "02d-onboarding-notifications", scheme);
    await page.click(".ob-foot .btn");
    await page.waitForSelector(".bubble.agent", { timeout: 10000 });
    await wait(4500);
    await shot(page, "02e-onboarding-intro", scheme);
    await ctx.close();
  },
};

try {
  for (const scheme of ["light", "dark"]) {
    for (const [name, fn] of Object.entries(scenes)) {
      if (only.length && !only.includes(name) && !only.includes(scheme)) continue;
      console.log(`${name} (${scheme})`);
      try {
        await fn(scheme);
      } catch (e) {
        console.error(`  failed: ${e.message}`);
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
