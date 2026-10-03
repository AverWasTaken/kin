// Renders the app icons from one SVG of the default avatar. Run: npm run icons
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(out, { recursive: true });

const body = "M60 22 C81 22 90 40 90 62 C90 86 77 100 60 100 C43 100 30 86 30 62 C30 40 39 22 60 22 Z";

function creature({ scale = 3.6, cy = 268 } = {}) {
  return `
  <ellipse cx="256" cy="${cy + 47 * scale}" rx="${30 * scale}" ry="${5 * scale}" fill="#2B2418" opacity="0.10"/>
  <g transform="translate(256 ${cy}) scale(${scale}) translate(-60 -61)">
    <path d="${body}" fill="url(#body)" stroke="#4DAF92" stroke-width="2.5" stroke-linejoin="round"/>
    <ellipse cx="43" cy="34" rx="7" ry="4.2" fill="#fff" opacity="0.3" transform="rotate(-28 43 34)"/>
    <g fill="#FF6B8B" opacity="0.42"><ellipse cx="42" cy="64" rx="5" ry="3"/><ellipse cx="78" cy="64" rx="5" ry="3"/></g>
    <ellipse cx="49" cy="56" rx="3.7" ry="4.7" fill="#1E2124"/><circle cx="47.8" cy="54.2" r="1.3" fill="#fff"/>
    <ellipse cx="71" cy="56" rx="3.7" ry="4.7" fill="#1E2124"/><circle cx="69.8" cy="54.2" r="1.3" fill="#fff"/>
    <path d="M56.5 65 Q60 68.4 63.5 65" stroke="#1E2124" stroke-width="2" stroke-linecap="round" fill="none"/>
  </g>`;
}

const defs = `
  <defs>
    <radialGradient id="body" cx="36%" cy="28%" r="78%">
      <stop offset="0%" stop-color="#8DD7C1"/><stop offset="55%" stop-color="#57C4A4"/><stop offset="100%" stop-color="#49A58A"/>
    </radialGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FCFAF5"/><stop offset="100%" stop-color="#EEE9DE"/>
    </linearGradient>
  </defs>`;

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}
  <rect width="512" height="512" fill="url(#bg)"/>${creature()}
</svg>`;

const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}
  <rect width="512" height="512" fill="url(#bg)"/>${creature({ scale: 2.8, cy: 262 })}
</svg>`;

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}
  <rect width="512" height="512" rx="116" fill="url(#bg)"/>${creature()}
</svg>`;

// Monochrome silhouette for the Android notification badge.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <mask id="m"><path d="${body}" fill="#fff"/>
  <ellipse cx="49" cy="56" rx="4.2" ry="5.2" fill="#000"/><ellipse cx="71" cy="56" rx="4.2" ry="5.2" fill="#000"/></mask>
  <rect width="120" height="120" fill="#fff" mask="url(#m)"/>
</svg>`;

writeFileSync(join(out, "icon.svg"), favicon);

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(svg, size, file, transparent = false) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({ path: join(out, file), omitBackground: transparent });
}
await png(icon, 512, "icon-512.png");
await png(icon, 192, "icon-192.png");
await png(icon, 180, "apple-touch-icon.png");
await png(maskable, 512, "maskable-512.png");
await png(badge, 96, "badge-96.png", true);
await browser.close();
console.log("icons written to", out);
