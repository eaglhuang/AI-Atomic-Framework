#!/usr/bin/env sh
set -eu

node atm.mjs atm-chart verify --json

staged_paths="$(git diff --cached --name-only | grep -v '^\.atm/history/evidence/git-head\.json$' || true)"
if [ -n "$staged_paths" ]; then
  node atm.mjs hook pre-commit --json
else
  node atm.mjs tasks audit --json
fi

if [ -d ".atm/agent-pack" ]; then
  for manifest in .atm/agent-pack/*.manifest.json; do
    [ -e "$manifest" ] || continue
    pack_id="$(basename "$manifest" .manifest.json)"
    node atm.mjs agent-pack verify-fresh --id "$pack_id" --json
  done
fi

if [ -d ".atm/integrations" ]; then
  for manifest in .atm/integrations/*.manifest.json; do
    [ -e "$manifest" ] || continue
    adapter_id="$(basename "$manifest" .manifest.json)"
    node atm.mjs integration verify "$adapter_id" --json
  done
fi
