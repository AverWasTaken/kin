#!/usr/bin/env node
import { createApp } from "./app.js";
import { env, loadSecrets, resolvePaths, saveSecrets } from "./config.js";
import { startServer } from "./server.js";
import { runCommand } from "./claude/process.js";

const [cmd = "start", ...args] = process.argv.slice(2);
const paths = resolvePaths();

async function main() {
  switch (cmd) {
    case "start": {
      const app = createApp(paths);
      app.start();
      const server = startServer(app);
      app.log("kin", `listening on http://${env.host}:${env.port} (data ${paths.data}, home ${paths.home})`);
      app.log("kin", `chat ${env.chatModel}/${env.chatEffort}, background ${env.bgModel}/${env.bgEffort}`);
      const shutdown = () => {
        app.log("kin", "shutting down");
        app.stop();
        server.close();
        setTimeout(() => process.exit(0), 1500).unref();
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      break;
    }
    case "token":
      console.log(loadSecrets(paths).ownerToken);
      break;
    case "secret": {
      const [name, value] = args;
      const secrets = loadSecrets(paths);
      if (name === "ha") {
        secrets.haToken = value;
        if (args[2]) secrets.haUrl = args[2];
      } else {
        console.error("Usage: kin secret ha <long-lived-token> [url]");
        process.exit(1);
      }
      saveSecrets(paths, secrets);
      console.log("Saved. Restart kin to apply.");
      break;
    }
    case "doctor": {
      const v = await runCommand(env.claude, ["--version"]).catch((e) => ({ code: 1, output: String(e) }));
      console.log(`claude: ${v.output.trim()}`);
      const a = await runCommand(env.claude, ["auth", "status"]).catch((e) => ({ code: 1, output: String(e) }));
      console.log(`auth: ${a.code === 0 ? "ok" : a.output.trim()}`);
      const m = await runCommand(env.claude, ["mcp", "list"], 90_000).catch((e) => ({ code: 1, output: String(e) }));
      console.log(m.output.trim());
      console.log(`data: ${paths.data}\nhome: ${paths.home}`);
      break;
    }
    default:
      console.error("Usage: kin start | token | secret ha <token> [url] | doctor");
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
