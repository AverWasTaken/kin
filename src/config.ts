import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Paths {
  data: string; // ~/.kin: db, secrets, generated claude config
  home: string; // ~/kin-home: the agent's cwd
}

export interface Secrets {
  ownerToken: string;
  vapid: { publicKey: string; privateKey: string } | null;
  haToken?: string;
  haUrl?: string;
}

export function resolvePaths(): Paths {
  const data = path.resolve(process.env.KIN_DATA ?? path.join(os.homedir(), ".kin"));
  const home = path.resolve(process.env.KIN_HOME ?? path.join(os.homedir(), "kin-home"));
  return { data, home };
}

export function atomicWrite(file: string, content: string, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, { mode });
  fs.renameSync(tmp, file);
}

export function loadSecrets(paths: Paths): Secrets {
  const file = path.join(paths.data, "secrets.json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const secrets: Secrets = { ownerToken: crypto.randomBytes(24).toString("base64url"), vapid: null };
  saveSecrets(paths, secrets);
  return secrets;
}

export function saveSecrets(paths: Paths, secrets: Secrets) {
  atomicWrite(path.join(paths.data, "secrets.json"), JSON.stringify(secrets, null, 2));
}

export const env = {
  port: Number(process.env.KIN_PORT ?? 3015),
  host: process.env.KIN_HOST ?? "127.0.0.1",
  claude: process.env.KIN_CLAUDE ?? "claude",
  /** Opus at medium effort for the foreground conversation. */
  chatModel: process.env.KIN_CHAT_MODEL ?? "opus",
  chatEffort: process.env.KIN_CHAT_EFFORT ?? "medium",
  /** Sonnet at medium effort for everything that runs in the background. */
  bgModel: process.env.KIN_BG_MODEL ?? "sonnet",
  bgEffort: process.env.KIN_BG_EFFORT ?? "medium",
  maxBackground: Number(process.env.KIN_MAX_BACKGROUND ?? 2),
  idleExitMs: Number(process.env.KIN_IDLE_EXIT_MS ?? 30 * 60_000),
  webDist: process.env.KIN_WEB_DIST,
  /** VAPID subject. Apple's push service rejects localhost subjects with 403 BadJwtToken. */
  vapidSubject: process.env.KIN_VAPID_SUBJECT ?? "https://kin.example.com",
};
