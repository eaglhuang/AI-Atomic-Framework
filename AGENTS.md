# ATM Bootstrap Instructions

This repository uses the default ATM bootstrap pack.

Captain/dispatch entry gate: if the user asks for Captain, Coordinator, dispatch, task cards, sidecars, subagents, delegation, condition review, or closeout work, first route the request through `ai-role-router` when available, then through `atm-dispatch` before drafting instructions, delegating work, or reviewing another agent. State `Skill used: atm-dispatch` and the chosen `Delegation mode`. Internal sidecar is the default for review, preflight, grep, checklist, planning-only checks, and post-report verification. External dispatch is opt-in, and external write is forbidden unless the user explicitly grants write authority and scope.

Start with this line when a user has given you a concrete request:

Read README.md if present, then run `node atm.mjs next --prompt "<current user prompt>" --json` from the repository root before task work. If there is no current user prompt and you are only checking repository orientation, `node atm.mjs next --json` is read-only status. If the result includes ATM_USER_NOTICE or evidence.userNotice, show it to the user before executing the returned next action. Use .atm/history/tasks/BOOTSTRAP-0001.json, .atm/runtime/profile/default.md, and .atm/history/evidence/BOOTSTRAP-0001.json only as supporting runtime state.

If the request says to finish all task cards, a whole plan, a task family, or multiple tasks, you must let `next --prompt` route it as `recommendedChannel: "batch"` and then use `node atm.mjs batch checkpoint --actor <id> --json` after delivering the current queue head. Do not manually loop over `tasks reserve/promote/claim/close`.

Use `node atm.mjs next --json` only as read-only repository orientation when there is no current user prompt.

First-contact behavior:

1. For user-requested task work, run `node atm.mjs next --prompt "<current user prompt>" --json`; use `node atm.mjs next --json` only as read-only orientation when no user prompt is available.
2. If the ATM result returns an `ATM_USER_NOTICE` message or `evidence.userNotice`, show that notice to the user in natural language before running the returned next action.
3. If an existing host instruction references a missing local document, mention the missing file once and continue with the ATM route.
4. After an onboarding or refresh command succeeds, return to the user original request and continue the actual work.

Editor integration self-check:

1. If `.atm/config.json` exists, confirm this editor already has its repo-local ATM entry files before trusting ATM skill routing.
2. If the current editor entry file is missing, install the matching adapter immediately with `node atm.mjs integration add <editor-id> --json`, then verify it with `node atm.mjs integration verify <editor-id> --json`.
3. Expected primary entry files:
   - `codex`: `integrations/codex-skills/atm-governance-router/SKILL.md` via `node atm.mjs integration add codex --json`
   - `claude-code`: `.claude/skills/atm-governance-router/SKILL.md` via `node atm.mjs integration add claude-code --json`
   - `cursor`: `.cursor/rules/skills/atm-governance-router/SKILL.md` via `node atm.mjs integration add cursor --json`
   - `copilot`: `.github/instructions/atm-governance-router.instructions.md` via `node atm.mjs integration add copilot --json`
   - `gemini`: `.gemini/commands/atm-governance-router.toml` via `node atm.mjs integration add gemini --json`
   - `antigravity`: `GEMINI.md` via `node atm.mjs integration add antigravity --json`
4. Google-side coverage has two entry shapes: `gemini` installs Gemini CLI command files under `.gemini/commands`, while `antigravity` installs the Antigravity editor entry `GEMINI.md` and `.agents/skills`. If the current Google editor is Antigravity, verify/install `antigravity`, not only `gemini`.

Python-only runtime self-check:

1. If the project probe reports Python without JavaScript or TypeScript, candidate ranking and source inventory can continue, but atom birth/apply must not be described as ready until a Python runtime/language adapter or plugin has been selected.
2. If this ATM release does not bundle a dedicated Python language adapter/plugin, say that explicitly. Treat it as an expected product gap, not as host-repo corruption.
3. In that case, continue with ATM discovery routes such as candidate ranking, source inventory, police evidence, or docs-first work, and tell the user that Python atom birth/apply remains deferred until a Python adapter/plugin is installed or implemented.

Bootstrap files:

- Task: .atm/history/tasks/BOOTSTRAP-0001.json
- Lock: .atm/runtime/locks/BOOTSTRAP-0001.lock.json
- Profile: .atm/runtime/profile/default.md
- Project probe: .atm/runtime/project-probe.json
- Default guards: .atm/runtime/default-guards.json
- Evidence: .atm/history/evidence/BOOTSTRAP-0001.json

Operating rules:

1. Keep the host workflow as manual.
2. Treat the repository kind as generic-repository.
3. Do not invent a package manager or build step when the probe reports none.
4. Write a short evidence update before finishing the bootstrap task.
