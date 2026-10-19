#!/bin/bash
# #359 / #361: the kit wrapper must parse and locate hunks exactly like the CLI.
# 1. bin/unified-patch.generated.mjs is the current type-stripped copy of
#    packages/core/src/broker/unified-patch.ts.
# 2. Both modules behave identically on a fixed + seeded corpus.
# 3. atm-write.mjs imports the generated copy and keeps no parser of its own.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"

node "$HERE/bin/generate-unified-patch.mjs" --check
node --experimental-strip-types --no-warnings "$HERE/test/hunk-locator-parity.mjs"

grep -q "from './unified-patch.generated.mjs'" "$HERE/bin/atm-write.mjs"
if grep -nE 'function parsePatchHunks|function patchApplicability|function patchLineIndexes|matchAll\(/\^@@' "$HERE/bin/atm-write.mjs"; then
  echo "atm-write.mjs still carries its own unified-diff parser" >&2
  exit 1
fi
echo "hunk locator parity ok"
