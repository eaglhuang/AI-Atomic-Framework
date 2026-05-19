# Environment Variables

This document lists every `ATM_*` environment variable consumed by the
AI-Atomic-Framework CLI and runtime. The authoritative source is
[`packages/cli/src/config/env-registry.ts`](../packages/cli/src/config/env-registry.ts);
this file MUST stay aligned with that registry.

Variables are partitioned by **surface**:

- **public** — supported host-facing knobs. Hosts and CI pipelines may set these.
- **internal-test** — provided for the framework's own tests and dev workflows.
  Hosts should not rely on these; they may change without a release-train bump.

All values are read as trimmed strings. Empty / whitespace-only values are
treated as unset.

---

## Public

### `ATM_TEMP_ROOT`

- **Kind:** path
- **Purpose:** Override the directory used for ephemeral workspaces
  (e.g. `self-host-alpha`, smoke tests).
- **Default when unset:** OS temp dir under a workspace-specific subfolder.
- **Consumer:** `packages/cli/src/temp-workspace.ts`

### `ATM_RELEASE_TRUST_ROOT`

- **Kind:** path
- **Purpose:** Override where the CLI looks for the bundled release trust
  manifest at startup.
- **Default when unset:** Bundled trust manifest shipped with the package.
- **Consumer:** `packages/cli/src/startup-integrity.ts`

### `ATM_COMPATIBILITY_MATRIX_PATH`

- **Kind:** path
- **Purpose:** Override the path to `compatibility-matrix.json` (ATMChart
  version compatibility data).
- **Default when unset:** Bundled `compatibility-matrix.json` at the framework
  root.
- **Consumer:** `packages/cli/src/commands/atm-chart.ts`

### `ATM_KNOWN_BAD_VERSIONS_PATH`

- **Kind:** path
- **Purpose:** Override the path to `known-bad-versions.json` (startup
  safeguard manifest that pins the CLI from running on a known-broken release).
- **Default when unset:** Walk up from the bundled manifest root; missing
  manifest is treated as "no entries".
- **Consumer:** `packages/cli/src/startup-known-bad.ts`

### `ATM_KNOWN_BAD_ROOT`

- **Kind:** path
- **Purpose:** Override the root directory searched for
  `known-bad-versions.json`. Useful when bundling the manifest outside the
  default search path.
- **Default when unset:** Module-relative search starting at
  `packages/cli/src`.
- **Consumer:** `packages/cli/src/startup-known-bad.ts`

---

## Internal / test-only

These are not part of the supported host contract. They exist for the
framework's own fixtures and development loops.

### `ATM_COMPATIBILITY_LEGACY_MATRIX_PATH`

- **Kind:** path
- **Purpose:** Override the path to the legacy compatibility matrix used for
  migration fixtures.
- **Default when unset:** Bundled legacy matrix path; absence is treated as no
  legacy data.
- **Consumer:** `packages/cli/src/commands/atm-chart.ts`

### `ATM_KNOWN_BAD_VERSION`

- **Kind:** string
- **Purpose:** Force the CLI to report a specific version at startup for
  known-bad checks. Used to exercise the safeguard without mutating
  `package.json`.
- **Default when unset:** Version read from the framework `package.json`.
- **Consumer:** `packages/cli/src/startup-known-bad.ts`

---

## Adding a new ATM_* variable

1. Add a descriptor entry to
   [`packages/cli/src/config/env-registry.ts`](../packages/cli/src/config/env-registry.ts).
2. Mirror the entry in this document under the matching surface section.
3. Read the value through `readEnvVar(name)` from the registry (preferred) or
   `process.env.NAME` directly. Either is allowed; the registry is the
   documentation source.
4. If the variable affects host-visible CLI output, add a fixture under
   `tests/cli/` so behavior is captured.
