# Integration Plugin Collaboration Matrix

ATM core owns neutral governance primitives. Integration plugins only automate entry and guard invocation.

## Core vs Integration

- Core: `actor`, `tasks reserve/promote/claim/renew/release/handoff/takeover/close`, `evidence`, `guard`, `git`.
- Integration plugin: editor-specific invocation convenience and optional hook wiring.
- Hooks are opt-in hardening, not the only safety boundary.

## Thin Hook Contract

Hook logic must stay thin:

- allowed: `atm guard mutation` and light argument normalization.
- not allowed: build/lint/test execution, network calls, writing repo-tracked files, mutating task state.
- timeout: short by default.
- timeout/failure default: fail-open with clear warning.
- fail-closed only for deterministic governance violations (missing claim, owner mismatch, scope outside claim).

## Automation Levels

- Claude Code:
  - native skill entry + optional PreToolUse hook recipe.
  - preferred guard: `atm guard mutation`.
- Codex:
  - skill/AGENTS workflow + `next --claim`.
  - if no hook boundary, rely on post-edit guard + pre-commit/CI gates.
- Cursor:
  - rules/MCP wrapper recipe.
  - fallback to claim + git/evidence gates when hooks are unavailable.
- Gemini:
  - command template route + optional thin hook recipe.
  - fallback to claim + git/evidence gates when hooks are unavailable.
- Antigravity:
  - root discovery in `GEMINI.md` plus ATM command skills under `.agents/skills`.
  - fallback to claim + git/evidence gates when hooks are unavailable.

All integrations must call the same core commands and must not fork governance logic.

## Raw Git Mutation Boundary

Supported pre-tool integrations must treat raw Git index/worktree mutation as a hard gate, not as advisory prose. The guard rejects direct `git restore`, `git restore --staged`, `git reset`, `git checkout -- <path>`, `git switch -f`, `git clean`, `git rm`, `git update-index`, `git read-tree`, `git commit`, and `git push` from agent tool calls unless the operation is routed through ATM-governed Git commands and Broker leases.

| Adapter | Raw Git mutation gate | Verification |
| --- | --- | --- |
| Codex | Hard-gated when `integration hook pre-tool` is installed or invoked by the host surface. | `node --strip-types tests/cli/integration-raw-git-command-guard.test.ts` |
| Claude Code | Hard-gated when the PreToolUse hook recipe calls `node atm.mjs integration hook pre-tool`. | `node --strip-types tests/cli/integration-raw-git-command-guard.test.ts` |
| Cursor | Advisory unless the MCP/wrapper recipe invokes the same pre-tool hook before shell execution. | `node --strip-types tests/cli/integration-raw-git-command-guard.test.ts` |
| Gemini | Advisory unless the command-template route invokes the same pre-tool hook before shell execution. | `node --strip-types tests/cli/integration-raw-git-command-guard.test.ts` |
| Antigravity | Advisory unless the workspace-root instruction bridge invokes the same pre-tool hook before shell execution. | `node --strip-types tests/cli/integration-raw-git-command-guard.test.ts` |

Chat text or a copied override phrase is not an unlock. Stage-only and destructive Git overrides must be represented as ATM leases with actor, task, path, TTL, and audit evidence, then consumed by an ATM Git command. Raw shell commands remain blocked even when the phrase appears in the command string.
