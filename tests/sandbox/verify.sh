#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sandbox_root="${1:-}"

node --experimental-strip-types "$script_dir/sandbox-fixture.ts" verify "$sandbox_root" "$script_dir/expected-output.json"
