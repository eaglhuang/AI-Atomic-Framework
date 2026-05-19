# ATM Bootstrap Instructions

This repository uses the default ATM bootstrap pack.

Start with this line:

Read README.md if present, then run "node atm.mjs next --json" from the repository root. If the result includes `ATM_USER_NOTICE` or `evidence.userNotice`, show it to the user before executing the returned next action. Use .atm/history/tasks/BOOTSTRAP-0001.json, .atm/runtime/profile/default.md, and .atm/history/evidence/BOOTSTRAP-0001.json only as supporting runtime state.

Bootstrap files:

- Task: .atm/history/tasks/BOOTSTRAP-0001.json
- Lock: .atm/runtime/locks/BOOTSTRAP-0001.lock.json
- Profile: .atm/runtime/profile/default.md
- Project probe: .atm/runtime/project-probe.json
- Default guards: .atm/runtime/default-guards.json
- Evidence: .atm/history/evidence/BOOTSTRAP-0001.json

Operating rules:

1. Keep the host workflow as manual.
2. Treat the repository kind as framework-repository.
3. Do not invent a package manager or build step when the probe reports npm.
4. Write a short evidence update before finishing the bootstrap task.

Editor integration self-check:

1. If `.atm/config.json` exists, confirm this editor already has its repo-local ATM entry files before trusting ATM skill routing.
2. If the current editor entry file is missing, install the matching adapter immediately with `node atm.mjs integration add <editor-id> --json`, then verify it with `node atm.mjs integration verify <editor-id> --json`.
3. Expected primary entry files:
   - `codex`: `integrations/codex-skills/atm-governance-router/SKILL.md`
   - `claude-code`: `.claude/skills/atm-governance-router/SKILL.md`
   - `cursor`: `.cursor/rules/skills/atm-governance-router/SKILL.md`
   - `copilot`: `.github/instructions/atm-governance-router.instructions.md`
   - `gemini`: `.gemini/commands/atm-governance-router.toml`

Python-only runtime self-check:

1. If the project probe reports Python without JavaScript or TypeScript, candidate ranking and source inventory can continue, but atom birth/apply must not be described as ready until a Python runtime/language adapter or plugin has been selected.
2. If this ATM release does not bundle a dedicated Python language adapter/plugin, say that explicitly. Treat it as an expected product gap, not as host-repo corruption.
3. In that case, continue with ATM discovery routes such as candidate ranking, source inventory, police evidence, or docs-first work, and tell the user that Python atom birth/apply remains deferred until a Python adapter/plugin is installed or implemented.

---

## Framework Orientation

This is the **AI-Atomic-Framework (ATM)** repository — a governance framework for AI-assisted engineering work. If you are a new agent working on this repo, complete the bootstrap step above first, then use the references below.

| Entry point | Purpose |
|---|---|
| `README.md` | Framework overview, core concepts, and How-It-Works diagram |
| `.atm/memory/atm-chart.md` | ATMChart — rendered rule summary for the current repository state |
| `docs/AGENT_PACK_ONBOARDING.md` | First-touch onboarding: welcome flow, ATMChart, integration agent packs |
| `docs/SELF_HOSTING_ALPHA.md` | Self-hosting reference for adopter repositories |
| AtomicCharter | Framework-level invariants and waiver authority (resolved by `atm next`) |

## Key Rules

- **Do not create a parallel task model.** `node atm.mjs next --json` is the single deterministic router.
- **Do not mark work done without evidence.** ATM requires guard output, artifacts, or attestation before closing a work item.
- **Do not modify `.atm/` runtime state directly.** Use CLI commands; the runtime directory is managed by ATM.
- **Do not add host-specific policy to framework docs.** Adopter rules belong in adapter or plugin configuration, not in `packages/core` or protected public docs.

## Diagnosing Repository State

`node atm.mjs next --json` distinguishes three states:

| State | Meaning | Next step |
|---|---|---|
| `ready` | ATM is bootstrapped and has a governed next action | Execute the returned command |
| `needs-bootstrap` | Repository has not been initialized as an ATM adopter | See `docs/SELF_HOSTING_ALPHA.md` for bootstrap options |
| `no-work` | ATM is bootstrapped but the work queue is empty | Add governed work items or consult the ATMChart |

If `node atm.mjs doctor --json` reports errors, follow the `resolution` hints before doing other work.

## Framework vs Adopter Repository

This is the **framework repository**. Downstream adopter repositories generate their own AGENTS.md via `node atm.mjs install-agent-pack`. The framework AGENTS.md you are reading now is not a template for adopter entry files; it is the orientation point for contributors working on ATM itself.

## Quick Reference

```shell
# Orientation and welcome
node atm.mjs welcome --json

# Render or verify the ATMChart
node atm.mjs atm-chart render
node atm.mjs atm-chart verify

# Deterministic next governed action
node atm.mjs next --json

# Health check
node atm.mjs doctor --json

# Framework version
node atm.mjs --version
```
