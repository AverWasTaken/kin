#!/usr/bin/env bash
# Build the PWA locally, copy everything to a server over ssh, build the server there and (re)start pm2.
# Usage: KIN_DEPLOY_HOST=myserver bash scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${KIN_DEPLOY_HOST:?set KIN_DEPLOY_HOST to the ssh host to deploy to}"
DEST="${KIN_DEPLOY_DIR:-kin}"

npm --prefix web run build
tar czf - --exclude=node_modules --exclude=./.git --exclude=./dist --exclude=./.vitest --exclude=./.kin-dev \
  --exclude=web/node_modules --exclude=web/screenshots --exclude=web/src . |
  ssh "$HOST" "mkdir -p ~/$DEST && tar xzf - -C ~/$DEST"
ssh "$HOST" "cd ~/$DEST && npm install --no-audit --no-fund --omit=dev >/dev/null && npm install --no-save typescript >/dev/null && npx tsc -p . && (pm2 describe kin >/dev/null 2>&1 && pm2 reload ecosystem.config.cjs --update-env || pm2 start ecosystem.config.cjs) && pm2 save >/dev/null"
echo "Deployed. Owner token: ssh $HOST 'cd ~/$DEST && node dist/cli.js token'"
