import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Ported from soprano/src/process.ts: resolve npm's Windows .cmd wrappers to their JS entry point without a shell.
export function executable(binary: string): { command: string; prefix: string[] } {
  if (/\.(?:c?js|mjs)$/.test(binary) && fs.existsSync(binary)) return { command: process.execPath, prefix: [path.resolve(binary)] };
  if (process.platform !== "win32") return { command: binary, prefix: [] };
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const exe = path.join(dir, binary.endsWith(".exe") ? binary : `${binary}.exe`);
    if (fs.existsSync(exe)) return { command: exe, prefix: [] };
    const cmd = path.join(dir, binary.endsWith(".cmd") ? binary : `${binary}.cmd`);
    if (fs.existsSync(cmd)) {
      const match = fs.readFileSync(cmd, "utf8").match(/"%dp0%\\([^"\r\n]+\.js)"/i);
      if (match) return { command: process.execPath, prefix: [path.resolve(dir, match[1])] };
    }
  }
  return { command: binary, prefix: [] };
}

export function runCommand(binary: string, args: string[], timeout = 10000, env?: NodeJS.ProcessEnv, cwd?: string) {
  return new Promise<{ code: number; output: string }>((resolve, reject) => {
    const spec = executable(binary);
    const child = spawn(spec.command, [...spec.prefix, ...args], { windowsHide: true, env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    const add = (data: Buffer) => {
      output = (output + data.toString()).slice(-65536);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output });
    });
  });
}

/** Splits a byte stream into JSON lines, guarding against runaway lines (2 MB, as in soprano's runner). */
export function lineReader(onLine: (line: string) => void, onOverflow: () => void) {
  let buffer = "";
  const feed = (chunk: Buffer | string) => {
    buffer += chunk.toString();
    let i: number;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) onLine(line);
    }
    // Only an unterminated remainder can be runaway.
    if (buffer.length > 2_097_152) {
      buffer = "";
      onOverflow();
    }
  };
  feed.flush = () => {
    if (buffer.trim()) onLine(buffer.trim());
    buffer = "";
  };
  return feed;
}
