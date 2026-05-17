#!/usr/bin/env sh
set -eu

node atm.mjs doctor --json
node atm.mjs constitution verify --json

if [ -d ".atm/integrations" ]; then
  for manifest in .atm/integrations/*.manifest.json; do
    [ -e "$manifest" ] || continue
    adapter_id="$(basename "$manifest" .manifest.json)"
    node atm.mjs integration verify "$adapter_id" --json
  done
fi