#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sandbox_root="${1:-}"
source_root="${2:-}"

node "$script_dir/sandbox-fixture.mjs" setup "$sandbox_root" "$source_root"
