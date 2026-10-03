import crypto from "node:crypto";
import path from "node:path";
import { atomicWrite, env } from "../config.js";
import type { App } from "../app.js";

/** Built-in tools that would bypass Kin's own scheduling, notifications and chat surface. */
export const DISALLOWED = [
  "CronCreate",
  "CronDelete",
  "CronList",
  "ScheduleWakeup",
  "PushNotification",
  "RemoteTrigger",
  "EnterWorktree",
  "ExitWorktree",
  "DesignSync",
  "ReportFindings",
  "SendMessage",
  "ListAgents",
];

/** Full shell, files and web are always allowed (per the owner). Everything else asks via mcp__kin__approve. */
export const BASE_ALLOW = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "NotebookEdit",
  "Task",
  "Agent",
  "TodoWrite",
  "Skill",
  "ToolSearch",
  "Monitor",
  "TaskStop",
  "mcp__kin",
];

export interface RunContext {
  threadId: string;
  runId: string | null;
  kind: string;
  /** Proactive runs may read connected apps but never write to them (enforced in the approval gate). */
  readOnly: boolean;
}

export interface ClaudeLaunch {
  args: string[];
  env: NodeJS.ProcessEnv;
  token: string;
  files: string[];
}

export function launch(
  app: App,
  opts: { ctx: RunContext; model: string; effort: string; systemPrompt: string; stream: boolean; resume?: string; sessionId?: string },
): ClaudeLaunch {
  const token = crypto.randomBytes(24).toString("base64url");
  app.tokens.set(token, opts.ctx);
  const dir = path.join(app.paths.data, "claude");
  const tag = opts.ctx.runId ?? `chat-${opts.ctx.threadId}`;
  const mcpFile = path.join(dir, `${tag}.mcp.json`);
  const promptFile = path.join(dir, `${tag}.prompt.md`);
  const settingsFile = path.join(dir, `${tag}.settings.json`);
  // "Always allow" rules never apply to read-only runs: leaving them out keeps those tools on the approval gate, which denies them.
  const allow = opts.ctx.readOnly ? BASE_ALLOW : [...BASE_ALLOW, ...app.allowRules()];

  const servers: Record<string, unknown> = {
    kin: { type: "http", url: `http://127.0.0.1:${app.port}/mcp`, headers: { Authorization: `Bearer ${token}` } },
  };
  const ha = app.secrets.haToken;
  if (ha)
    servers.homeassistant = {
      type: "http",
      url: `${(app.secrets.haUrl ?? "http://127.0.0.1:8123").replace(/\/$/, "")}/api/mcp`,
      headers: { Authorization: `Bearer ${ha}` },
    };
  atomicWrite(mcpFile, JSON.stringify({ mcpServers: servers }, null, 2));
  atomicWrite(promptFile, opts.systemPrompt);
  atomicWrite(
    settingsFile,
    JSON.stringify(
      {
        permissions: { allow, defaultMode: "default" },
        includeCoAuthoredBy: false,
      },
      null,
      2,
    ),
  );

  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    opts.model,
    "--effort",
    opts.effort,
    "--mcp-config",
    mcpFile,
    "--settings",
    settingsFile,
    // Skip the owner's personal ~/.claude settings (hooks, plugins); connectors come from the login, not settings.
    "--setting-sources",
    "project,local",
    "--permission-prompt-tool",
    "mcp__kin__approve",
    "--append-system-prompt-file",
    promptFile,
    "--disallowedTools",
    DISALLOWED.join(","),
  ];
  if (opts.stream) args.push("--input-format", "stream-json", "--include-partial-messages", "--replay-user-messages");
  if (opts.resume) args.push("--resume", opts.resume);
  else if (opts.sessionId) args.push("--session-id", opts.sessionId);

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    // Approval cards can wait a long time for the owner; keep the MCP call open for a day.
    MCP_TOOL_TIMEOUT: String(25 * 3600_000),
    // HTTP MCP calls otherwise abort after 300s without a response (verified on 2.1.284).
    CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: String(25 * 3600_000),
    MCP_TIMEOUT: "30000",
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
    KIN_RUN_TOKEN: token,
  };
  delete childEnv.KIN_DATA;
  return { args, env: childEnv, token, files: [mcpFile, promptFile, settingsFile] };
}

export const models = {
  chat: () => ({ model: env.chatModel, effort: env.chatEffort }),
  background: () => ({ model: env.bgModel, effort: env.bgEffort }),
};
