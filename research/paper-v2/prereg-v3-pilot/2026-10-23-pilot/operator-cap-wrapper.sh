#!/bin/bash
set -euo pipefail
if [ "${1:-}" = exec ] && [ "${2:-}" != --help ]; then
  exec /usr/bin/timeout --signal=TERM --kill-after=10s 1200 /home/box/.local/node22/bin/codex "$@"
fi
exec /home/box/.local/node22/bin/codex "$@"
