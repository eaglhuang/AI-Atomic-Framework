#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sandbox_root="${1:-}"

node "$script_dir/sandbox-fixture.mjs" verify "$sandbox_root" "$script_dir/expected-output.json"
