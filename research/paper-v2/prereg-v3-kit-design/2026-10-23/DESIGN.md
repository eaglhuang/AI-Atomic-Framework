# New prereg-v3 kit design for #367

Owner decision: 2026-10-23 18:13 Asia/Taipei. Design first; no formal runs. The old r=3 proposal is withdrawn from execution. Pilot PR #407 is merged; all existing kit and evidence generations remain immutable. This document is a design commitment, not a statement that the new kit or dataset is ready.

## Delivery and dependency gates

1. Commit this design in its own PR; merge only after green CI.
2. Issue #398: seal a model-free four-submission cross-session replay against the published CLI and old kit before fixing anything. Keep the original session slots and startup base, omit manual base/attempt overrides, and retain patches, receipts, before/after bytes and commit attribution. Replay the corresponding direct core path separately. A core diagnosis requires direct-core evidence, not an inference from kit output. Fix the demonstrated boundary in a separate PR with regression coverage.
3. Issue #374: fix or stably reject the three EOF-marker cases in parser and composer; retain item 4's git-parity insertion placement. Include LF/CRLF/empty-base and exact-byte differential regressions. Generate the new kit copy from the fixed source; do not regenerate the old sealed kit. Separate PR, green CI.
4. Validate and seal a new dataset and kit generation, with launcher/scorer/preflight coverage for all three arms. New paths under `research/paper-v2/`; one labelled EVIDENCE_INDEX row per sealed generation, hashes, and provenance. No mutation of old manifests or archived runs.
5. After offline tests pass, record a tiny real smoke condition: one development group, k=2, stagger 0, one repetition, all three arms; never a held-out group. Seal it separately and publish a verdict. Any kit-error makes the affected run INVALID; a paired experiment with an invalid arm is INVALID. Missing measurements remain null.
6. Write `/workspace/codex-runs/formal-runs-plan.md` v3 with the validated frozen inputs, split, schedule and measured budgeting. No formal model runs without subsequent user sign-off.

## CLI pin

Start from the validated published CLI 0.1.22 boundary for the diagnostic replay. Keep the new kit on 0.1.22 if its required contracts are sufficient. The owner permits pinning the new kit to published 0.1.23 only if needed; verify npm runtime identity and record the exact package/runtime digest and necessity before smoke. A core fix absent from a published runtime must not be represented as evaluated by that runtime. New version publication is not authorized by this design; surface an actual release dependency if one is demonstrated. Do not change the old kit pin.

## Distinct runnable groups and held-out protection

Target G_main=4 distinct benchmark task pairs plus G_held_out=2 additional pairs (six total). Every pair consists of two original public benchmark instances; repeated executions never create new groups. No instance ID may appear in two groups or in both splits. Record repository, immutable source dataset revision/hash and licence, original problem text and gold/test patches, original bases, common base, changed files and conflict classification (T1–T6 or C0).

Use the newer original base as the common base. For each task independently on that pristine base, require clean application of its gold patch and test patch (any explicit test rebase must preserve test identity and be separately audited), a working environment, fail-to-pass failure before the gold fix and success after it, and pass-to-pass preservation. Preserve all screening failures and exclusions; an unrunnable backup does not count. Pairwise sequential-gold compatibility/conflict is measured and classified, not silently repaired. Reject duplicate/equivalent fixes and fixes already present at the common base. Preserve original task text. A shortage blocks dataset readiness rather than permitting invented or relabelled groups.

Freeze the selection algorithm and split seed before outcome collection. After runnable eligibility checks, assign groups by a recorded deterministic hash order with seed `367-newkit-split-v1`; reserve the last two eligible selected pairs as held-out. The validated selection inventory and split manifest are hashed before development smoke. Held-out instances receive only automated eligibility/gold validation; no model development runs, prompt tuning, oracle tuning, or smoke on them. Readiness requires four eligible main pairs and an independent held-out split, not merely six candidate names. Runtime/environment coverage and licensing are eligibility gates.

## Comparable arms

All arms use identical model/CLI version, effort, task text, k, stagger, session caps and task-group base. A/B retain their shared-worktree semantics and existing Unix-user containment. Neutral baseline instructions and fixed ATM instructions are archived with hashes and lengths. New measurement rules apply equally to every arm; old data is not rescored.

- **A (B-shared)**: one shared worktree, sessions directly edit and commit through ordinary git. Record intended changes and actual per-session end snapshots separately.
- **B (ATM)**: one shared worktree, writes/commits only through the published ATM steward. Preserve the original read/intent coordinate across malformed replies and refreshed current hashes; a current-file reply alone is not acknowledgement of another session's change. Any explicit acknowledgement must be represented and counted. Retain proposal/session/base attribution, rejection reason codes, commit bytes and final preservation checks.
- **B-wt**: isolated worktree and branch per session from the same common base; sessions directly edit and commit their own fixes, cannot write another session's tree or integration tree, and cannot access gold/oracle/held-out files. Integrate session branches in ascending numeric slot order. Preserve branches, merge receipts and all intermediate snapshots/diffs. No silent last-writer-wins or unmeasured manual resolution.

For B-wt merge conflicts, start a fresh resolver session on only the integration worktree with the same fixed model/effort. Prompt template: `Resolve the recorded merge conflicts in this integration worktree, preserve both submitted issue intents where possible, and run the supplied acceptance tests. Do not read gold patches or change task scope. Report unresolved conflicts explicitly.` Append only the two original issue texts, conflicting paths and permitted test commands. Freeze the full prompt bytes/hash before smoke. R_max=2 fresh resolution rounds per conflicting merge; each round has its own 20-minute cap and complete wall/token/tool accounting. On exhaustion, record unresolved/needs-intervention with null manual time if no intervention occurs; do not invent a resolution or charge zero tokens. No unapproved human repair during the smoke. Resolver failures and kit failures are distinct dispositions.

## Measurements and oracle/scorer contract

Predeclare per-task machine-checkable behavioral assertions from benchmark acceptance tests, plus syntactic/file-integrity checks. Capture each task session's own end state before later integration and the final shared/integrated tree. M1 successful-at-end versus absent-at-final losses must not conflate an unsubmitted intended hunk with an accepted change; report intended-but-unsubmitted/blocked work separately. Retain raw intended patches for audit. For B, independently check accepted commit bytes against receipt and final-tree attribution, including the #398 guard-removal replay.

Report per arm/task group: completion and invalidity status; per-session and per-resolution-round wall time, reported token fields (including cached/reasoning where supplied), unique logged tool-call items, exit/cap/quota status; merge/conflict/rejection/resubmission counts with denominators; kit-error counts and attempted-arm rate; oracle/gold-test outcomes; corruption; lost and silent lost edits with original/final snapshot provenance. Do not derive a reported total_tokens from partial token fields. Derived budgeting proxies must be explicitly labelled. Missing timer/token/tool observations and unresolved manual effort remain null. Preflight probes and resolver sessions are accounted separately from task sessions.

Regression fixtures must distinguish known accepted overwrite from rejected/unsubmitted intent, exercise uncommitted snapshots, stale/malformed refresh, cross-session versus same-session writes, and known merge/conflict counts. Oracle and scorer must inspect the same immutable tree. All three arms must have complete fail-closed evidence validation; stub success is not real smoke success.

## Containment and operational bounds

Use a newly created, short clone-local scratch root for every execution. Cleanup is authorized only inside that new root, never existing files or `/tmp` top-level. No credentials in archives; logs are allowlisted and scanned. Preserve old generations, workflows and .atm state (CLI writes only). node22 npm is selected explicitly. No paid fallback or quota retries beyond the preregistered preflight missing-marker policy.

Task and resolver session wall caps: 20 minutes. Every git/ATM command stays below 15 minutes and each shell/governance step below 30 minutes. Run long jobs detached with logs and bounded stages; inspect progress and investigate any step approaching 30 minutes. Poll each PR's CI through single REST calls at intervals no longer than five minutes. ATM channel order is quickfix, framework-mode, task card last; record GOV-FRICTION on refusal. Changes are small PRs with green CI before merge; process fixes stay in implementation history and evidence, not paper prose.

## Smoke and plan v3 exit criteria

Readiness requires a sealed runnable six-pair inventory and independent split, exact source/generated parser parity, the sealed #398 attribution and regression, all three arm containment/preflight regressions, a complete three-arm one-group real smoke, and a verdict reporting every kit-error and counterexample without a win claim. Formal plan v3 must name exact G/split, arms, k, stagger, repetitions, seed support or null and fixed order, task/resolver/session and aggregate caps, expected/guarded wall time, measured token and cost estimates with uncertainty, and a cheaper alternative. Values are frozen as a proposal for user sign-off, not permission to start formal runs.
