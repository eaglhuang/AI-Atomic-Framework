#!/bin/bash
# #367: local and CI entrypoint; no model, npm download, or sealed-run mutation.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../.." && pwd)"
cd "$ROOT"
START=$SECONDS
for test in \
  tests/cli/unified-patch-locator.test.ts \
  tests/cli/unified-patch-eol.test.ts \
  tests/cli/unified-patch-eof-newline.test.ts \
  tests/cli/unified-patch-v10c-replay.test.ts \
  tests/core/stale-base-translation.test.ts \
  tests/core/cross-session-overlap.test.ts \
  tests/core/live-queued-write.test.ts \
  tests/core/live-write-commit-path.test.ts; do
  printf 'Running %s (%ss elapsed)\n' "$test" "$((SECONDS - START))"
  node --strip-types "$test"
done
KIT=research/paper-v2/prereg-v3-smoke/kit
node "$KIT/test/hunk-locator-parity.mjs"
node "$KIT/test/test-live-write-journal-parity.mjs"
python3 "$KIT/test/test_writer_metrics_366.py"
python3 "$KIT/test/test_metrics_366.py"
printf 'Running fake codex integration (%ss elapsed)\n' "$((SECONDS - START))"
node "$KIT/test/test-stub-concurrency.mjs"
printf 'Stub concurrency suite passed in %ss\n' "$((SECONDS - START))"
