# Troubleshooting

Common failure modes when adopting or maintaining ATM, with the diagnostic
command that surfaces the cause and the typical fix.

## How to read this guide

Each entry follows the same shape:

- **Symptom** — what you observed.
- **Diagnose** — the deterministic command that surfaces structured detail
  (always `--json`).
- **Fix** — the smallest action that resolves it.
- **Prevent** — optional pointer to the relevant invariant / fixture.

---

## Bootstrap & adoption

### `node atm.mjs next --json` reports `needs-bootstrap`

- **Symptom:** Running `next` in a repository returns
  `{ "status": "needs-bootstrap" }` with reason `.atm/config.json is missing`.
- **Diagnose:** `node atm.mjs doctor --json` → `evidence.checks[]` will show
  `governance-layout-v2.ok: false`.
- **Fix:** `node atm.mjs bootstrap --cwd . --task "Bootstrap ATM in this repository"`.
- **Prevent:** Keep `.atm/runtime/` checked-out per project policy; never
  delete `.atm/config.json` directly.

### Bootstrap reports `source-unavailable` for the pinned runner

- **Symptom:** `LocalGovernanceBootstrapResult.pinnedRunner.status` is
  `source-unavailable` with reason "No pinned onefile launcher source was
  available."
- **Diagnose:** Check whether `release/atm-onefile/atm.mjs` exists, or set
  `ATM_PINNED_RUNNER_SOURCE` / `ATM_ONEFILE_LAUNCHER_PATH`. See
  [`docs/environment-variables.md`](./environment-variables.md).
- **Fix:** Run `npm run build` to produce `release/atm-onefile/atm.mjs`, or
  point `ATM_PINNED_RUNNER_SOURCE` at an existing launcher.
- **Prevent:** CI should run `npm run build` before invoking `bootstrap` so
  the pinned runner is reachable.

### `verify --agents-md` fails with `contains vendor-specific marker`

- **Symptom:** `node atm.mjs verify --agents-md --json` returns
  `ok: false` with details `issues: ["contains vendor-specific marker: <name>"]`.
- **Diagnose:** Open `AGENTS.md` and search for the listed marker. The
  neutrality scanner flags adopter / vendor names that leak into protected
  surface.
- **Fix:** Remove or genericize the marker. If the marker is intentional
  (e.g. linking to an adapter README), move the reference into
  `examples/<adapter>/README.md` and replace the AGENTS.md mention with a
  neutral wrapper sentence.
- **Prevent:** Invariant **I4** (neutrality). `validate:neutrality` covers
  the SSoT scan.

---

## CLI invocation

### `--json` output is empty / "CLI output is not valid JSON"

- **Symptom:** A spawned `atm.mjs <command> --json` returns nothing on
  stdout, or the validator harness reports "CLI output is not valid JSON".
- **Diagnose:** Re-run the same command without redirection:
  `node atm.mjs <command> --json 2>&1 | head -40`. Look for a stack trace
  before any JSON envelope.
- **Fix:** If the trace is a `CliError`, the JSON envelope follows it — most
  shells truncate. Pipe through `tail -1` or rerun without redirection.
  If the trace is a raw `Error`, file a bug; per the
  [CLI error policy](./cli-error-policy.md) only `CliError` should escape.
- **Prevent:** Invariant **I1** (public CLI surface stable). Release-smoke
  fixtures in `tests/cli/` pin the JSON envelope shape.

### Exit code 2 from a CLI command

- **Symptom:** `node atm.mjs <command> ...` exits with status 2.
- **Diagnose:** Read the JSON `severity` and `exitCode` fields together.
  Exit code `2` means **usage error** (`severity: usage-error`) — bad flag,
  missing required argument, or an action against an uninitialized repo.
  Exit code `1` with `severity: blocked` means governance routing blocked the
  action; follow `evidence.nextAction` instead of treating it as a validator
  failure. The `message.code` field names the specific check.
- **Fix:** Check the `messages[].text` field for the corrective instruction.
  Common cases: missing `--pack`, missing `--task`, no `.atm/config.json`
  yet (run `bootstrap` first).
- **Prevent:** See [`docs/cli-error-policy.md`](./cli-error-policy.md) for
  the exit code policy.

---

## Validators

### `validate:standard` shows X/53 passing but X < 53

- **Symptom:** The standard validator suite reports failures, often unrelated
  to the work you just did.
- **Diagnose:** Run `npm run validate:standard 2>&1 | grep FAIL` to list the
  failing validators. Then run the single failing validator directly, e.g.
  `npm run validate:<name>`.
- **Fix:** If the failure references a file you didn't touch, the working
  tree may have uncommitted or partially-merged changes. Check
  `git status --short` for `UU` (unmerged) entries.
- **Prevent:** Always run `validate:quick` before opening a PR.
  `validate:standard` should run in CI on every commit.

### Skew-matrix smokes fail with a syntax error in another package

- **Symptom:** `validate:standard` reports
  `[skew-matrix:validate] FAIL ... SyntaxError ... in packages/<other>/src/...`.
- **Diagnose:** The skew-matrix smokes spawn the CLI in a sandbox; if any
  package source has a syntax error the CLI cannot parse it and every
  spawned smoke fails. The error is in the package named in the trace, not
  in skew-matrix itself.
- **Fix:** Resolve the syntax error in the named package. Often this is an
  in-flight merge conflict — check for `UU` entries in `git status`.
- **Prevent:** Don't run `validate:standard` against a working tree with
  unmerged conflicts.

---

## Versions & releases

### `ATM_CHART_STALE` from `atm-chart verify`

- **Symptom:** `node atm.mjs atm-chart verify --json` fails with code
  `ATM_CHART_STALE` and reason "ATMChart markdown is stale".
- **Diagnose:** `atm-chart verify` compares the recorded source hashes
  against current `default-guards.json` and schema files. Drift means one
  side moved.
- **Fix:** `node atm.mjs atm-chart render --cwd . --json` to re-render the
  ATMChart from current sources.
- **Prevent:** Invariant **I2** (schema additive-first). When changing a
  guard or schema, re-run `atm-chart render` in the same change.

### `ATM_AGENT_PACK_STALE` from `agent-pack verify-fresh`

- **Symptom:** `node atm.mjs agent-pack verify-fresh --pack <id>` fails with
  `ATM_AGENT_PACK_STALE`.
- **Diagnose:** The installed agent pack manifest records hashes of the ATM
  source guards / schemas at install time. A mismatch means the framework
  has moved since the pack was installed.
- **Fix:** `node atm.mjs agent-pack install --pack <id>` to re-install with
  the current source hashes.
- **Prevent:** Invariant **I5** (manifest stability). Agent pack manifests
  are part of the public contract; track upgrade via this command, not by
  editing the manifest.

---

## Adapter / host integration

### Hooks not triggering on commits

- **Symptom:** A commit goes through without `pre-commit` running the ATM
  doctor check.
- **Diagnose:** Check `.git/hooks/pre-commit` exists and is executable
  (`ls -la .git/hooks/pre-commit`).
- **Fix:** The hooks are an **opt-in host recipe**, not auto-installed by
  ATM. Follow [`examples/git-hooks-enforcement/README.md`](../examples/git-hooks-enforcement/README.md)
  to install them.
- **Prevent:** See
  [`docs/HOST_GOVERNANCE_INTEGRATION.md`](./HOST_GOVERNANCE_INTEGRATION.md)
  for the boundary between ATM-native and host-recipe enforcement.

### `atm doctor` reports `ATM_DOCTOR_GIT_EVIDENCE_MISSING`

- **Symptom:** Doctor fails because the HEAD commit has no matching ATM
  evidence record.
- **Diagnose:** Open `.atm/history/evidence/git-head.json` (if present) and
  check whether its `commitSha` or `treeSha`+`parentCommitShas` match the
  current HEAD.
- **Fix:** Run an explicit evidence-recording step before the next commit,
  or back-fill: `node atm.mjs handoff summarize --task <id> --json` followed
  by the corresponding evidence write.
- **Prevent:** See the host-recipe pre-commit hook in
  [`examples/git-hooks-enforcement/`](../examples/git-hooks-enforcement/).

---

## Environment variables

### `ATM_TEMP_ROOT` ignored

- **Symptom:** A workspace gets created under the system temp dir even
  though you set `ATM_TEMP_ROOT`.
- **Diagnose:** The env var must be set in the shell that spawns
  `atm.mjs`, not in a downstream child process. Echo it before invoking:
  `echo "$ATM_TEMP_ROOT" && node atm.mjs self-host-alpha --verify --json`.
- **Fix:** Export in the right scope. On Windows PowerShell, use
  `$env:ATM_TEMP_ROOT = "C:\path"`.
- **Prevent:** See [`docs/environment-variables.md`](./environment-variables.md)
  for the registry of supported `ATM_*` variables.

---

## When in doubt

1. `node atm.mjs doctor --json` — full health snapshot of the repo's ATM
   state.
2. `node atm.mjs next --json` — what the framework thinks you should do
   next.
3. `npm run validate:quick` — fast subset of validators, typically <30 s.
4. Check `git status --short` for unmerged or unexpected modifications.

If none of those surfaces the cause, the workflow is:
1. Capture the failing command + full JSON output.
2. Capture `git status --short` and the commit SHA.
3. File a GitHub issue with both, plus the relevant `--json` evidence.
