#!/usr/bin/env node
// Stand-in for `claude -p` that speaks the stream-json protocol closely enough to exercise Kin end to end.
import fs from "node:fs";
import readline from "node:readline";

const args = process.argv.slice(2);
if (process.env.FAKE_ARGS_LOG) fs.appendFileSync(process.env.FAKE_ARGS_LOG, JSON.stringify(args) + "\n");
if (args[0] === "--version") {
  console.log("2.1.284 (Claude Code)");
  process.exit(0);
}
if (args[0] === "mcp" && args[1] === "list") {
  console.log("Checking MCP server health…\n\nclaude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected");
  process.exit(0);
}
if (args[0] === "auth") process.exit(0);

const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const session = arg("--resume") ?? arg("--session-id") ?? "fake-session";
const mcp = JSON.parse(fs.readFileSync(arg("--mcp-config"), "utf8")).mcpServers.kin;
const out = (o) => process.stdout.write(JSON.stringify({ session_id: session, ...o }) + "\n");

async function callTool(name, input) {
  const res = await fetch(mcp.url, {
    method: "POST",
    headers: { ...mcp.headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: input } }),
  });
  const raw = await res.text();
  const data = raw.trim().startsWith("{") ? raw : (raw.split("\n").filter((l) => l.startsWith("data:")).pop() ?? "").slice(5);
  const body = JSON.parse(data);
  return body.result?.content?.[0]?.text ?? JSON.stringify(body);
}

out({ type: "system", subtype: "init", model: arg("--model"), tools: ["Bash"], mcp_servers: [{ name: "kin", status: "connected" }] });

async function reply(text) {
  const idMatch = text.match(/<msg id="([^"]+)"/);
  const body = text.replace(/<msg[^>]*>\n?/g, "").replace(/<\/msg>/g, "").trim();
  if (body.includes("approve-test")) {
    out({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: "mcp__claude_ai_Gmail__send_email", input: { to: "a@b.c", subject: "hi" } }] } });
    const decision = JSON.parse(await callTool("approve", { tool_name: "mcp__claude_ai_Gmail__send_email", input: { to: "a@b.c", subject: "hi" } }));
    return `approval: ${decision.behavior}`;
  }
  if (body.includes("react-test") && idMatch) await callTool("react", { message_id: idMatch[1], emoji: "👍" });
  if (body.includes("react-only") && idMatch) {
    out({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "mcp__kin__react" } } });
    await callTool("react", { message_id: idMatch[1], emoji: "❤️" });
    return "";
  }
  if (body.includes("task-test")) await callTool("start_task", { title: "Look into it", instructions: "do the thing" });
  if (body.includes("slow-test")) await new Promise((r) => setTimeout(r, 3000));
  return `echo: ${body.split("\n").pop()} (got it, on this now and will report back shortly)\n\nsecond thought: anything else you want me to look into while I'm at it today?`;
}

if (args.includes("stream-json") && arg("--input-format") === "stream-json") {
  const rl = readline.createInterface({ input: process.stdin });
  let chain = Promise.resolve();
  rl.on("line", (line) => {
    const msg = JSON.parse(line);
    if (msg.type === "control_request") {
      out({ type: "control_response", response: { subtype: "success", request_id: msg.request_id } });
      return;
    }
    chain = chain.then(async () => {
      out({ type: "user", message: { role: "user", content: msg.message.content } });
      const text = await reply(msg.message.content);
      if (text) {
        out({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
        out({ type: "assistant", message: { content: [{ type: "text", text }] } });
      }
      out({ type: "result", subtype: "success", is_error: false, result: text, usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0 });
    });
  });
  rl.on("close", () => chain.then(() => process.exit(0)));
} else {
  let prompt = "";
  process.stdin.on("data", (d) => (prompt += d));
  process.stdin.on("end", async () => {
    out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "WebSearch", input: { query: "something" } }] } });
    if (prompt.includes("SURFACE")) await callTool("send_message", { text: "Heads up from the background" });
    if (prompt.includes("FAIL-LIMIT")) {
      process.stderr.write("Claude usage limit reached. Your limit resets in 2 minutes\n");
      process.exit(1);
    }
    const summary = `summary: ${prompt.slice(0, 40)}`;
    out({ type: "assistant", message: { content: [{ type: "text", text: summary }] } });
    out({ type: "result", subtype: "success", is_error: false, result: summary, usage: { input_tokens: 20, output_tokens: 8 }, total_cost_usd: 0 });
  });
}
