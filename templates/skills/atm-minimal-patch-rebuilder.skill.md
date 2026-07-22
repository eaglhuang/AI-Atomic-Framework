---
name: atm-minimal-patch-rebuilder
description: Rebuild a minimal semantic patch from a formatter-contaminated or bulk-rewritten ATM file after line-budget commit failures such as ATM_TOUCHED_PHYSICAL_LINE_BUDGET_BLOCKED. Use when a governed commit fails because one file has thousands of formatting-only changed lines, when an agent needs to preserve intended hunks while discarding noisy rewrites, or when reconstructing a small patch from HEAD/current diffs before retrying ATM commit.
---

# ATM Minimal Patch Rebuilder

Use this skill to recover from a large dirty diff that hides a small intended
change, especially after `ATM_GIT_COMMIT_FAILED` with a nested
`ATM_TOUCHED_PHYSICAL_LINE_BUDGET_BLOCKED`.

## Rules

- Do not commit, close, release, stash, restore, checkout, reset, or clean unless
  the user explicitly asked for that action and the affected owner lane is clear.
- Do not impersonate another actor. If the dirty file belongs to another active
  claim, rebuild the patch only when the user/captain explicitly authorizes it,
  then stop before commit.
- Preserve semantic hunks; remove formatter-only, import-reflow, quote-style, or
  full-file expansion noise.
- Keep the index empty unless the task explicitly asks for staging.
- If the root cause is an ATM product gap, record it through `atm-bug-backlog`.

## Workflow

1. Inspect the commit failure.
   - Read `.atm/runtime/git-commit-attempts/<actor>__<task>.json` when the CLI
     only reports `ATM_GIT_COMMIT_FAILED`.
   - Capture nested `errorCode`, `errorSummary`, `headShaBeforeCommit`, and
     `headAdvancedDuringAttempt`.

2. Measure the noisy file.
   - Run `git diff --numstat -- <paths>`.
   - Treat any single file over the relevant line budget as a rebuild candidate.

3. Identify intended semantics.
   - Search current dirty content for task-specific symbols, flags, trailers,
     options, error codes, validators, or command names.
   - Compare with `git show HEAD:<path>` to locate the smallest baseline
     insertion points.

4. Rebuild from the baseline.
   - Prefer `apply_patch` for ordinary multi-line files.
   - For compressed one-line carrier files where `apply_patch` would be more
     error-prone, use a deterministic exact-match script that:
     - reads `git show HEAD:<path>`;
     - performs one-match string replacements with labels;
     - fails if any replacement matches zero or multiple locations;
     - writes only the target file;
     - prints applied labels.

5. Verify the reduction.
   - Run `git diff --numstat -- <path>`.
   - Run the focused validators relevant to the task.
   - Confirm `git diff --cached --name-only` is empty unless staging was
     explicitly requested.

6. Report the handoff.
   - State original numstat, rebuilt numstat, validators, files touched, staged
     state, and whether commit authority remains with another actor.

## Stop Conditions

- The intended semantic hunks cannot be identified confidently.
- Rebuild would discard another actor's unique work.
- The file still exceeds the line budget after rebuild.
- Focused validators fail.
- Recovery requires hand-editing `.atm/runtime` or `.atm/history`.
