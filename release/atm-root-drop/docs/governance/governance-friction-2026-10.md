# ATM governance friction log — October 2026

Scope: friction hit while running ATM's own governance (import → claim → sealed build →
evidence → `taskflow close` → clean sweep → PR → CI) for the paper-2.0 write-path fixes
#359, #362, #363, #373 and #360 (TASK-PRF-0135 … TASK-PRF-0145), 2026-10-19 … 2026-10-21
(Asia/Taipei). This is a process note. It is not paper text.

Evidence sources: `PROGRESS.md` on branches `fix/359-unified-patch-offset-locator`,
`fix/363-stale-base-translation`, `fix/373-close-recover`, `fix/360-cross-session-overlap`,
and the operator logs kept on the build box.

Severity: **high** = blocks progress or needs manual repair; **medium** = costs a whole
extra task round or a lot of agent tokens; **low** = annoyance with a known workaround.
**Daily** = hit on most working days by any agent doing governed work.

Status legend: *fixed* (already merged), *quick-fixed* (this round, PR linked), *proposed*
(design in [governance-token-cost-proposals-2026-10.md](proposals/governance-token-cost-proposals-2026-10.md)),
*note* (environment, no repo change).

## Summary

| # | Issue | Severity | Daily | Status |
|---|---|---|---|---|
| F1 | Interrupted `taskflow close --write` leaves a half-done transaction | high | yes | fixed in part by #373 (PR #376); rest proposed (P1) |
| F2 | Close-window staged-index lock left active after an interrupted close | high | no | fixed by #373 (`--recover/--abort`) |
| F3 | `tasks renew` reopened a closed task | high | no | fixed by #373 |
| F4 | Bundle assembly EISDIR on ignored nested run dir (`kit/state/runs/...`) | medium | no | fixed by #373 |
| F5 | Deliver bundle force-adds gitignored/generated files (vendored `.d.ts`, run state, gitlinks, `.pyc`) | high | yes | proposed (P2) |
| F6 | 600-line budget only fails in CI after the close | medium | yes | quick-fixed in #379 (merged 8d95caa1) (`npm run preclose:check`), gate-in-close proposed (P3) |
| F7 | `--help` usage snapshot drift only fails in CI after the close; no regenerate command | medium | yes | quick-fixed in #379 (merged 8d95caa1) (`npm run help-snapshots:update`, preclose check), proposed (P3) |
| F8 | Every tiny CI fix needs a full new task round | medium | yes | proposed (P4) |
| F9 | Verbose governance output is the main agent token cost | high | yes | quick-fixed in #379 (merged 8d95caa1) for build/sweep + AGENTS guidance; CLI-wide result line proposed (P5) |
| F10 | Same validators rerun in evidence, close, sweep and CI | medium | yes | proposed (P6) |
| F11 | No single build → close → sweep command; agents hand-chain and detach it | medium | yes | proposed (P7) |
| F12 | Agents poll CI repeatedly | medium | yes | quick-fixed in #379 (merged 8d95caa1) (AGENTS guidance) |
| F13 | Claim tickets expire during long waits, forcing `tasks renew` | low | yes | proposed (part of P1/P7) |
| F14 | Direction locks not restored on renew | low | no | limited: renew restores *released* locks only; needs a repro (backlog) |
| F15 | Pre-existing failing test `transactional-steward-single-write` (write path) | high | no | quick-fixed in #379 (merged 8d95caa1) (test updated to #363 contract) |
| F16 | Pre-existing failing test `commit-bundle-resolution` | medium | no | quick-fixed in #379 (merged 8d95caa1) (test outdated) |
| F17 | Scope glob `dir/**` does not cover the bare path `dir` (scope amendment needed for `packages/cli/dist`) | low | no | proposed (P2 appendix) |
| F18 | Validators assume linked worktrees are absent and blobs are present (census test, `blob:none` CI checkout) | low | no | fixed in TASK-PRF-0137/0138 |
| F19 | Smoke-runbook broker pin mismatches on every broker change | low | no | by design; re-pin after the write-path fixes |
| F20 | Flaky `tests/cli/broker-native-hot-concurrency.test.ts` in Product CI | medium | no | proposed (backlog, investigate) |
| F21 | Working folder must be named `AI-Atomic-Framework` | low | no | note |
| F22 | Per-command `--help` JSON is large (~23 KB for `tasks import --help`) | low | yes | proposed (P5) |
| F24 | Claim discovery: `tasks claim` says "not ready", `taskflow open --write` refuses in template-only mode; the working path is `next --claim --task <id> --auto-intent`, and it refuses while any uncommitted WIP intersects the scope | low | yes | proposed (P5 hint text) |
| F25 | A closed task cannot take a governed commit or publish the runner, so merging main after close (dist conflicts) or a one-line notes update needs a new task | medium | yes | proposed (P4); evidence TASK-PRF-0152, 0153 |
| F26 | Sealed-build failure result line has a generic hint ("see log") instead of the error | low | no | follow-up to #379 |
| F23 | Box environment: default Node 22 lacks `--strip-types`; Codex sandbox cannot spawn `git` (EPERM) | low | no | note |

## Details

### F1 Interrupted close (high, daily)
- Symptom: when the calling process is killed during `taskflow close --write`, the close
  stops at phase `ledger-written` with the bundle partly staged and no commit. A rerun is
  refused with `ATM_PLANNING_SOURCE_IDENTITY_DRIFT`.
- Evidence: TASK-PRF-0138 (2026-10-20 01:25), TASK-PRF-0140 (08:30; blocked ~16 h until #373).
- Status: #373 (TASK-PRF-0141, PR #376) added `taskflow close --recover|--abort`.
  The close is still long and still dies with its caller, so agents must run it under
  `setsid nohup`. Proposal P1.

### F2 / F3 / F4 (fixed by #373)
- F2: the `close-window-staged-index` lock stayed active after the 0138 crash; the only way
  out was a one-time approved hand edit of `.atm/runtime/locks/...` (2026-10-20 07:27).
- F3: `tasks renew` on TASK-PRF-0140 set the closed task back to `running` while the staged
  ledger said `done`.
- F4: bundle assembly read `kit/state/runs/.../work` and failed with EISDIR.

### F5 Deliver bundle force-adds ignored files (high, daily)
- Symptom: staging uses `git add -A -f`
  (`packages/cli/src/commands/taskflow/commit-bundle-assembly.ts`,
  `.../git-governance/implementation/sealed-commit-candidate-index.ts`), and the runner-sync
  receipt inventory becomes staging paths
  (`.../framework-development/runner-publication-close-handoff.ts`).
- Evidence: TASK-PRF-0135 re-added ~470 vendored `.d.ts`; TASK-PRF-0139 added 59;
  TASK-PRF-0141 added 1053 under `release/`; TASK-PRF-0144 (#360, PR #378, merged as
  324a5877) committed ~690 ignored files from the `research/paper-v2/prereg-v3-smoke/kit/**`
  scope: offline-preflight run state in `kit/state/`, nested work repos as gitlinks and a
  `.pyc`. They were removed in 5fa733495 but stay in main history.
  TASK-PRF-0150 (#379) again added 469 vendored `.d.ts`.
  Tracked `.d.ts` on main went 425 → 1013. `git ls-files -ci --exclude-standard` reports
  39,697 tracked-but-ignored files (research 30,650; release 7,263; packages 1,676;
  artifacts 97; .atm 11); most of `research/` is intentional evidence, the rest needs triage.
- Status: proposed (P2). `ignored-artifact-close-bundle.spec.ts` requires explicitly
  declared ignored deliverables to still be staged, so the fix must filter *automatic*
  candidates only.

### F6 / F7 Post-close CI failures (medium, daily)
- F6 evidence: TASK-PRF-0141 → `claim-orchestrator.ts` 655 lines (follow-up 0142);
  TASK-PRF-0140 → `steward-transactional-apply.ts` 602 lines after merging main (0143).
  No workflow calls `scripts/validate-physical-line-budget.ts` directly; Product CI fails via
  `tests/cli/physical-line-budget-gate.test.ts`. Close only checks touched files.
- F7 evidence: TASK-PRF-0144 added `broker --ack-overlap`; ATM Dogfood failed on
  `tests/cli-fixtures/help-snapshots/broker.json`; follow-up 0145 regenerated it by hand.
- Each cost a full new task with another sealed build.
- Quick fix: `npm run preclose:check` (repo line budget + help snapshot comparison, one
  result line) and `npm run help-snapshots:update`. Gate inside close: proposal P3.

### F8 Full task round per tiny fix (medium, daily)
- Evidence: six follow-up tasks in three days (0137, 0138, 0139, 0142, 0143, 0145), each
  with import, claim, sealed build with `ATM_RUNNER_PUBLICATION_TASK`, runner-sync receipt,
  evidence, close, sweep. Proposal P4.

### F9 Verbose output (high, daily) — main token driver
- Evidence: `taskflow close --json` result files of 904 KB (0135), 517 KB (0136),
  263 KB (0139 retry); the sealed build streams every child step to the terminal.
  An agent that reads these to find "ok or not, and why" spends most of its budget there.
- Existing but unused: `taskflow close` already supports the global flags `--summary`,
  `--fields` and `--output-json <file>` (`packages/cli/src/commands/shared/result-core.ts`),
  and compacts stdout unless `--verbose`. Agent guidance never mentioned them.
- Quick fix (#379): opt-in log-file mode for the sealed build and the CLI test sweep with
  one `ATM-RESULT` line; AGENTS.md section "Token-efficient governance runs". Dogfooded on
  TASK-PRF-0150: build stdout was one line; `taskflow close --summary --output-json` wrote a
  636-byte result instead of hundreds of KB.
- TASK-PRF-0150's own close again force-added 469 vendored `.d.ts` (F5).
- Proposal P5: the same one-line result for every governance command.

### F10 Duplicate validator runs (medium, daily)
- Evidence: the task validators run in `evidence run`, again in close, again in the clean
  sweep, and again in CI (e.g. 0135: npm ci + typecheck + 6 suites + broker suites + kit
  preflight in the sweep after the same suites passed for evidence). Proposal P6.

### F11 No ship wrapper (medium, daily)
- Evidence: every task used hand-written `build.sh`, `close.sh`, `sweep.sh`, `poll-ci.sh`
  scripts and `setsid nohup`. Proposal P7.

### F12 CI polling (medium, daily)
- Agents polled `gh pr checks` every few minutes. Quick fix: AGENTS guidance to wait once
  with `gh pr checks <pr> --watch --interval 120`.

### F13 Claim expiry during waits (low, daily)
- Evidence: 0139 and 0140 needed `tasks renew` before commit/close after long CI waits.

### F14 Direction locks on renew (low)
- `tasks renew` calls `restoreReleasedDirectionLockForRenewal`
  (`packages/cli/src/commands/tasks/claim-orchestrator.ts`); it restores only a *released*
  runtime lock and returns `not-needed` otherwise. Needs a repro of the observed case
  before any change.

### F15 / F16 Pre-existing failing tests
- F15 `tests/core/transactional-steward-single-write.test.ts` expected `blocked` but #363
  (stale-base translation) re-composes stale proposals by design. Test updated; no product change.
- F16 `packages/cli/src/commands/git-governance/implementation/commit-bundle-resolution.test.ts`
  fails at the `TASK-FOREIGN.bundle-manifest.json` skipped-file assertion. The test was
  outdated: a foreign staged deletion is now reported in `outOfScopeStagedFiles` and kept
  out of `commitFiles`. Test updated in #379; no product change.

### F17 Bare dir vs `dir/**` (low)
- TASK-PRF-0135 needed a scope amendment adding bare `packages/cli/dist` next to
  `packages/cli/dist/**`.

### F18 Validator environment assumptions (fixed)
- 0137: the runbook validator's `git worktree add` tripped the worktree call-site census.
- 0138: CI's `blob:none` checkout could not lazily fetch blobs into a `--shared` clone.

### F19 Runbook pin (low)
- `validate-hist-v2-smoke-runbook` fails PIN_MISMATCH whenever `packages/core/src/broker`
  changes. Intended; re-pin once after the write-path fixes.

### F20 Flaky concurrency test (medium)
- Product CI on b23f1145d (PR #378) failed only `tests/cli/broker-native-hot-concurrency.test.ts`
  (7-process broker register queue admission). The change did not touch that path; the suite
  passed in the previous Product CI run on 5fa733495 and 5/5 times locally. A re-run passed.
  Each flake costs a full CI round (~20 min) and an agent wake-up.

### F24 Claim discovery (low, daily)
- Evidence: TASK-PRF-0150 (2026-10-21 09:05). The first two documented-looking commands
  failed; the third worked after stashing the already-written changes
  (`ATM_CLAIM_FOREIGN_UNSTAGED_WIP`). Hints should name the working command.

### F25 Closed task is frozen even before merge (medium, daily)
- Evidence: after #379 closed (TASK-PRF-0150), merging main (#378) conflicted only in
  generated dist/release files. The rebuild failed: "Runner publication requires exactly
  one active release-surface claim for grok-bot; found 0", so TASK-PRF-0152 was opened
  just to rebuild. Adding two evidence lines to this note after TASK-PRF-0151 closed was
  refused by `atm git commit --task TASK-PRF-0151` (`ATM_GIT_COMMIT_BUNDLE_BLOCKED`:
  empty task-scoped candidate), so TASK-PRF-0153 carries them. Proposal P4.

### F26 Generic build failure hint (low)
- Evidence: the TASK-PRF-0150 merge rebuild printed
  `ATM-RESULT ... code=BUILD_STEP_FAILED hint="sealed build step failed; see log"`; the
  actual cause was one `Error:` line in the log. The hint should carry the first error line.

### F21–F23 Notes
- F21: ATM requires the working folder name `AI-Atomic-Framework`, so parallel clones need
  a parent folder each.
- F22: `node atm.mjs tasks import --help` prints ~23 KB of JSON.
- F23: on the box, put Node 24 first in PATH; run git-spawning tests outside the Codex
  sandbox.

## Token-cost drivers (ranked, by observation)
1. Reading close/build/sweep output (F9, F22).
2. Extra task rounds after post-close CI failures (F6, F7, F8).
3. Recovery after interrupted closes (F1–F3).
4. Re-running and re-reading the same validators (F10).
5. CI polling (F12).

### F27 Cross-branch task-ID collision (fixed by this PR)
- Parallel branches allocated TASK-PRF-0156 from local/main state. TASK-PRF-0157 refreshes all origin heads and scans remote card names and contents before automatic allocation; two-session regression coverage includes newly published unmerged cards and unavailable origin.

### F28 Publication claim expires during sealed compilation (fixed by this PR)
- A thirty-minute build outlived its publication claim and required a retry. TASK-PRF-0157 checks for two hours of remaining authority before private compilation and prints a concrete four-hour renew command when insufficient; publication still revalidates ownership. Regression coverage includes expiry and a competing session.

- Publication follow-up TASK-PRF-0158 keeps both helpers in existing tracked modules; the known forced-add friction requires a separate index cleanup after normal close.
