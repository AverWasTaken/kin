// Frame-pacing benchmark for the chat in mock mode, on WebKit at iPhone 15 size.
// Builds nothing: run `npm run build` first. Usage: node scripts/perf.mjs [runs=3]
// IDLE=1 measures the chat sitting still, for the machine's ceiling. DIST=dir picks the build.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { devices, webkit } from "playwright";
import { preview } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const runs = Number(process.argv[2] ?? 3);
// DIST=some-dir benchmarks another build (e.g. a saved baseline) instead of dist/.
const server = await preview({
  root,
  build: { outDir: process.env.DIST ?? "dist" },
  preview: { port: 5198, strictPort: true },
  logLevel: "error",
});
const browser = await webkit.launch();

// Counts frames and forced layout reads (getBoundingClientRect) from page start.
const probe = () => {
  window.__perf = { frames: [], rects: 0, on: false };
  const orig = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    if (window.__perf.on) window.__perf.rects++;
    return orig.call(this);
  };
  const tick = (t) => {
    if (window.__perf.on) window.__perf.frames.push(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

// A burst like a busy turn: three sends (receipts, reactions, state changes, replies)
// plus extra agent bubbles and state flips layered on top.
async function burst(page) {
  if (process.env.IDLE) {
    await page.evaluate(() => (window.__perf.on = true));
    await page.waitForTimeout(9000);
    return collect(page);
  }
  const send = async (t) => {
    await page.fill(".composer textarea", t);
    await page.click(".send-btn");
  };
  await page.evaluate(() => (window.__perf.on = true));
  const t0 = Date.now();
  const at = (ms) => page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)));
  await send("thanks! can you check my calendar?");
  await at(1200);
  await send("and the weather for saturday");
  await at(2400);
  await page.evaluate(() => {
    const m = window.__kinMock;
    let i = 0;
    const id = setInterval(() => {
      m.setState(["thinking", "working", "typing"][i % 3], "checking…");
      if (i % 2 === 0) m.say(`Burst bubble ${i}: a line or two of text so the list keeps growing.`);
      if (++i >= 12) clearInterval(id);
    }, 220);
  });
  await at(5200);
  await send("what about sunday?");
  await at(9000);
  return collect(page);
}

function collect(page) {
  return page.evaluate(() => {
    window.__perf.on = false;
    const f = window.__perf.frames;
    const gaps = f.slice(1).map((t, i) => t - f[i]);
    const dur = f[f.length - 1] - f[0];
    const sorted = [...gaps].sort((a, b) => a - b);
    return {
      fps: +((gaps.length / dur) * 1000).toFixed(1),
      dropped: gaps.filter((g) => g > 25).length, // missed at least one 60Hz vsync
      long: gaps.filter((g) => g > 50).length,
      worst: +Math.max(...gaps).toFixed(1),
      p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
      rects: window.__perf.rects,
    };
  });
}

const results = [];
for (let r = 0; r < runs; r++) {
  const ctx = await browser.newContext({ ...devices["iPhone 15"], viewport: { width: 393, height: 852 } });
  await ctx.addInitScript(probe);
  const page = await ctx.newPage();
  await page.goto("http://localhost:5198/?mock=1");
  await page.waitForSelector(".bubble");
  await page.waitForTimeout(1500);
  results.push(await burst(page));
  await ctx.close();
}
await browser.close();
server.httpServer.close();

const avg = (k) => +(results.reduce((n, r) => n + r[k], 0) / results.length).toFixed(1);
console.table(results);
console.log("mean", { fps: avg("fps"), dropped: avg("dropped"), long: avg("long"), worst: avg("worst"), p95: avg("p95"), rects: avg("rects") });
