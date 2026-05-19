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
