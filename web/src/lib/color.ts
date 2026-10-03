// Derives the app accent from the avatar color, keeping text contrast legible in both themes.

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [87, 196, 164];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB) {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

function rgbToHsl([r, g, b]: RGB): RGB {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]: RGB): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export function luminance([r, g, b]: RGB) {
  const c = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: RGB, b: RGB) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Moves lightness until the color reaches the target contrast against a background. */
function fitContrast(color: RGB, bg: RGB, target: number): RGB {
  const hsl = rgbToHsl(color);
  const darker = luminance(bg) > 0.4;
  let rgb = color;
  for (let i = 0; i < 40 && contrast(rgb, bg) < target; i++) {
    hsl[2] = Math.max(0, Math.min(1, hsl[2] + (darker ? -0.02 : 0.02)));
    rgb = hslToRgb(hsl);
  }
  return rgb;
}

const PAPER: RGB = [247, 245, 240];
const INK: RGB = [16, 17, 20];
const DARK_TEXT: RGB = [24, 26, 24];

/** Text color to set on top of a filled accent surface. */
export function onColor(hex: string) {
  const rgb = hexToRgb(hex);
  return contrast(rgb, DARK_TEXT) >= contrast(rgb, [255, 255, 255]) ? rgbToHex(DARK_TEXT) : "#ffffff";
}

export function accentVars(hex: string): Record<string, string> {
  const rgb = hexToRgb(hex);
  return {
    "--accent": rgbToHex(rgb),
    "--accent-ink": onColor(hex),
    "--accent-text-light": rgbToHex(fitContrast(rgb, PAPER, 4.6)),
    "--accent-text-dark": rgbToHex(fitContrast(rgb, INK, 5.5)),
    "--accent-rgb": rgb.join(", "),
  };
}

export function applyAccent(hex: string) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(accentVars(hex))) root.style.setProperty(k, v);
}

/** Mixes toward white (t > 0) or black (t < 0). */
export function shade(hex: string, t: number) {
  const rgb = hexToRgb(hex);
  const to = t > 0 ? 255 : 0;
  const a = Math.abs(t);
  return rgbToHex(rgb.map((v) => v + (to - v) * a) as RGB);
}
