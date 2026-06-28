#!/usr/bin/env sh
set -eu

runner="atm.mjs"
if [ -f "atm.dev.mjs" ] && [ -f "packages/cli/src/atm.ts" ] && [ -f "packages/core/src/index.ts" ]; then
  runner="atm.dev.mjs"
fi

node "$runner" atm-chart verify --json

staged_paths="$(git diff --cached --name-only | grep -v '^\.atm/history/evidence/git-head\.json$' || true)"
if [ -n "$staged_paths" ]; then
  node "$runner" hook pre-commit --json
else
  node "$runner" tasks audit --json
fi

if [ -d ".atm/agent-pack" ]; then
  for manifest in .atm/agent-pack/*.manifest.json; do
    [ -e "$manifest" ] || continue
    pack_id="$(basename "$manifest" .manifest.json)"
    node "$runner" agent-pack verify-fresh --id "$pack_id" --json
  done
fi

if [ -d ".atm/integrations" ]; then
  for manifest in .atm/integrations/*.manifest.json; do
    [ -e "$manifest" ] || continue
    adapter_id="$(basename "$manifest" .manifest.json)"
    node "$runner" integration verify "$adapter_id" --json
  done
fi
