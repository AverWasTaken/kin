// pm2 start ecosystem.config.cjs
// Set KIN_VAPID_SUBJECT to the https URL you open Kin at (or a mailto: address you own).
const home = require("node:os").homedir();
module.exports = {
  apps: [
    {
      name: "kin",
      script: "dist/cli.js",
      args: "start",
      cwd: __dirname,
      kill_timeout: 8000,
      max_memory_restart: "600M",
      env: {
        NODE_ENV: "production",
        KIN_PORT: "3015",
        KIN_HOST: "127.0.0.1",
        KIN_CLAUDE: `${home}/.local/bin/claude`,
        KIN_VAPID_SUBJECT: process.env.KIN_VAPID_SUBJECT || "https://kin.example.com",
        PATH: `${home}/.local/bin:${process.env.PATH}`,
      },
    },
  ],
};
