// Normalizes `claude -p --output-format stream-json` lines. Based on soprano/src/runners/parse.ts.

export type ClaudeEvent =
  | { type: "init"; sessionId: string; model: string; mcp: { name: string; status: string }[]; tools: string[] }
  | { type: "session"; sessionId: string }
  | { type: "block_start"; kind: "thinking" | "text" | "tool_use"; name?: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input: any }
  | { type: "tool_result"; id: string; isError: boolean; content: string }
  | { type: "user_echo"; text: string }
  | { type: "result"; ok: boolean; text: string; tokens: number; costUsd: number }
  | { type: "rate_limit"; window: string; utilization: number; resetsAt: number; status: string }
  | { type: "control_response"; requestId: string }
  | { type: "background_task"; subtype: string };

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((c: any) => (typeof c === "string" ? c : c?.type === "text" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
  return "";
}

export function parseLine(data: any): ClaudeEvent[] {
  const out: ClaudeEvent[] = [];
  switch (data?.type) {
    case "system":
      if (data.subtype === "init")
        out.push({
          type: "init",
          sessionId: data.session_id,
          model: data.model ?? "",
          mcp: (data.mcp_servers ?? []).map((s: any) => ({ name: String(s.name), status: String(s.status) })),
          tools: data.tools ?? [],
        });
      else if (/^task_|background_tasks/.test(String(data.subtype))) out.push({ type: "background_task", subtype: data.subtype });
      break;
    case "stream_event": {
      const ev = data.event;
      if (ev?.type === "content_block_start") {
        const kind = ev.content_block?.type;
        if (kind === "thinking" || kind === "redacted_thinking") out.push({ type: "block_start", kind: "thinking" });
        else if (kind === "text") out.push({ type: "block_start", kind: "text" });
        else if (kind === "tool_use" || kind === "server_tool_use")
          out.push({ type: "block_start", kind: "tool_use", name: ev.content_block.name });
      }
      break;
    }
    case "assistant":
      for (const block of data.message?.content ?? []) {
        if (block.type === "text" && block.text?.trim()) out.push({ type: "text", text: block.text });
        if (block.type === "tool_use") out.push({ type: "tool", id: block.id, name: block.name, input: block.input ?? {} });
      }
      break;
    case "user": {
      const content = data.message?.content;
      if (typeof content === "string") out.push({ type: "user_echo", text: content });
      else if (Array.isArray(content)) {
        const results = content.filter((c: any) => c?.type === "tool_result");
        for (const r of results)
          out.push({ type: "tool_result", id: r.tool_use_id, isError: !!r.is_error, content: contentText(r.content).slice(0, 4000) });
        if (!results.length) out.push({ type: "user_echo", text: contentText(content) });
      }
      break;
    }
    case "result": {
      const u = data.usage ?? {};
      out.push({
        type: "result",
        ok: !data.is_error && data.subtype === "success",
        text: String(data.result ?? (data.errors ?? []).join("\n") ?? ""),
        tokens:
          (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0),
        costUsd: data.total_cost_usd ?? 0,
      });
      break;
    }
    case "rate_limit_event": {
      const info = data.rate_limit_info ?? {};
      const windows = info.unifiedWindows ?? {};
      const [window, w] =
        (Object.entries(windows) as [string, any][]).sort((a, b) => (b[1]?.utilization ?? 0) - (a[1]?.utilization ?? 0))[0] ?? [];
      out.push({
        type: "rate_limit",
        window: window ?? info.rateLimitType ?? "",
        utilization: Number(w?.utilization ?? info.utilization ?? 0),
        resetsAt: Number(w?.resetsAt ?? info.resetsAt ?? 0) * 1000,
        status: String(info.status ?? ""),
      });
      break;
    }
    case "control_response":
      out.push({ type: "control_response", requestId: data.response?.request_id ?? "" });
      break;
  }
  if (data?.session_id && data.type !== "system") out.push({ type: "session", sessionId: data.session_id });
  return out;
}

export function planLimit(text: string): boolean {
  return /usage limit|rate.?limit.*plan|hit your.*limit|quota.*exceed|out of.*usage|limit.*resets? (at|in)|insufficient_quota/i.test(
    text,
  );
}

export function resetTime(text: string, current = Date.now()) {
  const match = text.match(/resets? in (\d+)\s*(minute|hour|second)/i);
  if (match)
    return current + Number(match[1]) * ({ second: 1000, minute: 60000, hour: 3600000 }[match[2].toLowerCase() as "second"] ?? 1000);
  return current + 3600000;
}

/** A short present-tense status line for the avatar while a tool runs. */
export function toolStatus(name: string, input: any = {}): string {
  const n = name.toLowerCase();
  if (n.startsWith("mcp__kin__")) {
    const t = n.slice(10);
    if (t === "start_task") return "starting a background task…";
    if (t.startsWith("schedule")) return "setting that up…";
    if (t.startsWith("goal")) return "updating your goals…";
    if (t === "library_save") return "saving to your library…";
    if (t === "feed_card" || t === "set_brief" || t === "idea_add") return "putting together your feed…";
    return "";
  }
  if (n.includes("gmail")) return "checking your email…";
  if (n.includes("calendar")) return "checking your calendar…";
  if (n.includes("drive")) return "looking through your Drive…";
  if (n.startsWith("mcp__homeassistant")) return "talking to your home…";
  switch (name) {
    case "WebSearch":
      return input.query ? `searching “${String(input.query).slice(0, 40)}”…` : "searching the web…";
    case "WebFetch":
      try {
        return `reading ${new URL(input.url).hostname.replace(/^www\./, "")}…`;
      } catch {
        return "reading a page…";
      }
    case "Bash":
      return input.description ? `${String(input.description).toLowerCase().slice(0, 48)}…` : "running a command…";
    case "Read":
      return "reading a file…";
    case "Write":
    case "Edit":
      return /(memory|soul|identity)\.md/.test(String(input.file_path ?? "")) ? "making a note…" : "writing…";
    case "Glob":
    case "Grep":
      return "looking through files…";
    case "Task":
    case "Agent":
      return "handing something off…";
    default:
      return "working on it…";
  }
}
