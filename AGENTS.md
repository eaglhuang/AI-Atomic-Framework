# ATM Bootstrap Instructions

## Day 1

Use only these five commands: `welcome`, `next`, `taskflow`, `evidence`, `doctor`.

**Empty queue: skip `guide`, `orient`, and `start`.** **Trust `evidence.nextAction.playbook` over a conflicting `nextAction.command`** (after claim it is often `start`; do not paste it). **Replace every `<...>` placeholder before pasting; unquoted `<id>` is a shell redirect.** **Do not dump the JSON. Write it to a file and extract fields with `jq`.**

First governed write, from the project root. Checked on npm 0.1.20. Change the title, goal, scope file, and validator for the real task. `--lane-session` comes from the playbook lines below; do not invent it.

```bash
node atm.mjs taskflow open --write --actor newcomer-ai --title "Add hello.txt" --goal "Create hello.txt with one line of text." --scope-path hello.txt --validator "test -f hello.txt" --json > /tmp/atm-open.json
TASK=$(jq -r '.evidence.generation.taskId' /tmp/atm-open.json)
node atm.mjs next --claim --actor newcomer-ai --task "$TASK" --json > /tmp/atm-claim.json
printf 'hello\n' > hello.txt
EVIDENCE=$(jq -r '.evidence.nextAction.playbook.commandSequence[] | select(startswith("node atm.mjs evidence run"))' /tmp/atm-claim.json)
CLOSE=$(jq -r '.evidence.nextAction.playbook.commandSequence[] | select(startswith("node atm.mjs taskflow close") and contains(" --write "))' /tmp/atm-claim.json)
bash -c "$EVIDENCE" > /tmp/atm-evidence.json
bash -c "$CLOSE" > /tmp/atm-close.json
jq -r '.ok, .messages[0].code' /tmp/atm-close.json
```

This block is the adopter path for an empty queue. This framework repository already has task cards; do not open a `hello.txt` card here.

`welcome --json` reports the product version at `evidence.versions.frameworkVersion`. Pin that npm version. Do not pin `evidence.versions.releaseTrain.frameworkVersion` (`0.0.0` on 0.1.20) or a git tag such as `v0.9.0-alpha.1`. `doctor --json` is the health check; its empty-project `evidence.recommendedAction` (`next --json`) is not this write.

Git `user.name` / `user.email` are the author of commits, including the commit inside `taskflow close --write`. ATM `identity set` is a different actor profile. On 0.1.20 a missing Git author fails close with `ATM_CLI_UNHANDLED` and no `identity set` hint. Set the Git author and retry the same close line.

## Day 2+

Captain, dispatch, wave, batch, and team flows are not day-1 work.

This repository uses the default ATM bootstrap pack.

Terminology boundary: ATM is the product, framework, CLI, and governance workflow. AI-Atomic-Framework is only this repository name; do not call ATM AAF or use AAF as a shorthand for the framework.

Captain/dispatch entry gate: if the user asks for Captain, Coordinator, dispatch, task cards, sidecars, subagents, delegation, condition review, or closeout work, first route the request through `ai-role-router` when available, then through `atm-dispatch` before drafting instructions, delegating work, or reviewing another agent. State `Skill used: atm-dispatch` and the chosen `Delegation mode`. Internal sidecar is the default for review, preflight, grep, checklist, planning-only checks, and post-report verification. External dispatch is opt-in, and external write is forbidden unless the user explicitly grants write authority and scope.

Start with this line when a user has given you a concrete request:

Read README.md if present, then run "node atm.mjs next --prompt \"<current user prompt>\" --json" from the repository root before task work. If there is no current user prompt and you are only checking repository orientation, "node atm.mjs next --json" is read-only status. In this framework repository, `node atm.mjs` is the stable frozen runner entrypoint; use `node atm.dev.mjs` only when explicitly validating unbuilt source changes to ATM itself. If the result includes `ATM_USER_NOTICE` or `evidence.userNotice`, show it to the user before executing the returned next action. Use .atm/history/tasks/BOOTSTRAP-0001.json, .atm/runtime/profile/default.md, and .atm/runtime/evidence-ledger/bundles/BOOTSTRAP-0001.json only as supporting runtime state.

After every `next --prompt` or `next --claim` response, read `evidence.nextAction.playbook` before editing, closing, or committing. The playbook is the short channel-specific work order; do not invent your own lifecycle.

Batch task rule:

- If the request says to finish all task cards, a whole plan, a task family, or multiple tasks, let `next --prompt` route it as `recommendedChannel: "batch"`.
- After claiming a batch route, work only on the queue head and run `node atm.mjs batch checkpoint --actor <id> --json` after delivering that task.
- Do not commit queue-head deliverables before `batch checkpoint` succeeds.
- After checkpoint succeeds, commit the deliverables together with the matching `.atm/history/tasks/<task>.json`, `.atm/history/evidence/<task>.bundle-manifest.json`, and `.atm/history/task-events/<task>/`.
- Do not manually loop over `tasks reserve/promote/claim/close`; the batch checkpoint is the governed completion entry.

Framework-repository exception:

- The ATM framework repository itself intentionally does **not** use `keep.md` or `keep.summary.md`.
- Do not treat a missing keep file in this repository as corruption or a bootstrap failure.
- For the ATM framework repo, the correct first-touch orientation is `README.md` plus `node atm.mjs next --prompt "<current user prompt>" --json` for user-requested task work. `node atm.mjs next --json` is read-only orientation only.
- `node atm.mjs` intentionally runs the frozen built ATM runner in this repo. Do not use it to test half-written source changes; use `node atm.dev.mjs` only when the task explicitly requires source-first framework validation.
- `atm next` reports `evidence.nextAction.runnerMode`. If `ATM_RUNNER_SYNC_REQUIRED` appears, run `ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build` and rerun `node atm.mjs`; do not switch ordinary governance work to `node atm.dev.mjs` to hide stale frozen artifacts.

Bootstrap files:

- Task: .atm/history/tasks/BOOTSTRAP-0001.json
- Lock: .atm/runtime/locks/BOOTSTRAP-0001.lock.json
- Profile: .atm/runtime/profile/default.md
- Project probe: .atm/runtime/project-probe.json
- Default guards: .atm/runtime/default-guards.json
- Evidence: .atm/runtime/evidence-ledger/bundles/BOOTSTRAP-0001.json

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
   - `antigravity`: `GEMINI.md`
4. Google-side coverage has two entry shapes: `gemini` installs Gemini CLI command files under `.gemini/commands`, while `antigravity` installs the Antigravity editor entry `GEMINI.md` and `.agents/skills`. If the current Google editor is Antigravity, verify/install `antigravity`, not only `gemini`.

Python-only runtime self-check:

1. If the project probe reports Python without JavaScript or TypeScript, candidate ranking and source inventory can continue, but atom birth/apply must not be described as ready until a Python runtime/language adapter or plugin has been selected.
2. If this ATM release does not bundle a dedicated Python language adapter/plugin, say that explicitly. Treat it as an expected product gap, not as host-repo corruption.
3. In that case, continue with ATM discovery routes such as candidate ranking, source inventory, police evidence, or docs-first work, and tell the user that Python atom birth/apply remains deferred until a Python adapter/plugin is installed or implemented.

---

## Framework Orientation

This is the **AI-Atomic-Framework** repository for **ATM** — a governance framework for AI-assisted engineering work. If you are a new agent working on this repo, complete the bootstrap step above first, then use the references below.

| Entry point | Purpose |
|---|---|
| `README.md` | Framework overview, core concepts, and How-It-Works diagram |
| `.atm/memory/atm-chart.md` | ATMChart — rendered rule summary for the current repository state |
| `docs/AGENT_PACK_ONBOARDING.md` | First-touch onboarding: welcome flow, ATMChart, integration agent packs |
| `docs/SELF_HOSTING_ALPHA.md` | Self-hosting reference for adopter repositories |
| `.agents/skills/atm-bug-backlog/SKILL.md` | Bug backlog router: classifies ATM bugs vs project bugs before writing repo-specific backlog files |
| `docs/governance/atm-bug-and-optimization-backlog.md` | ATM-owned Bug and Optimization Backlog for ATM framework, CLI, governance, and Team Agents issues |
| AtomicCharter | Framework-level invariants and waiver authority (resolved by `atm next`) |

## Key Rules

- **Do not create a parallel task model.** `node atm.mjs next --prompt "<current user prompt>" --json` is the deterministic router for user-requested work.
- **Do not mark work done without evidence.** ATM requires guard output, artifacts, or attestation before closing a work item.
- **Do not modify `.atm/` runtime state directly.** Use CLI commands; the runtime directory is managed by ATM.
- **Do not add host-specific policy to framework docs.** Adopter rules belong in adapter or plugin configuration, not in `packages/core` or protected public docs.
- **Bug backlog routing.** If the user mentions bug backlog, bug record, optimization backlog, bug 紀錄表, 優化事項, or ATM Bug and Optimization Backlog, use `.agents/skills/atm-bug-backlog/SKILL.md` first. Record ATM framework/CLI/governance/Team Agents issues in `docs/governance/atm-bug-and-optimization-backlog.md`; record adopter/app/project issues in that repo's `docs/governance/project-bug-and-optimization-backlog.md`. Do not use release incident response docs for ordinary dogfood bugs.

## Diagnosing Repository State

`node atm.mjs next --prompt "<current user prompt>" --json` distinguishes user-requested task routes; `node atm.mjs next --json` is read-only orientation when no prompt exists.

| State | Meaning | Next step |
|---|---|---|
| `ready` | ATM is bootstrapped and has a governed next action | Execute the returned command |
| `needs-bootstrap` | Repository has not been initialized as an ATM adopter | See `docs/SELF_HOSTING_ALPHA.md` for bootstrap options |
| `no-work` | ATM is bootstrapped but the work queue is empty | Add governed work items or consult the ATMChart |

If `node atm.mjs doctor --json` reports errors, follow the `resolution` hints before doing other work.

## Framework vs Adopter Repository

This is the **framework repository**. Downstream adopter repositories generate their own AGENTS.md via `node atm.mjs install-agent-pack`. The framework AGENTS.md you are reading now is not a template for adopter entry files; it is the orientation point for contributors working on ATM itself.

Framework repositories and adopter repositories have different documentation expectations:

- Framework repo: no keep file is required; read `README.md` and follow `node atm.mjs next --prompt "<current user prompt>" --json` for user-requested task work.
- Adopter / planning repo: local `keep` documents may exist and should be treated as host-specific operating memory.

## Quick Reference

```shell
# Orientation and welcome
node atm.mjs welcome --json

# Render or verify the ATMChart
node atm.mjs atm-chart render
node atm.mjs atm-chart verify

# Deterministic next governed action
node atm.mjs next --prompt "<current user prompt>" --json

# Health check
node atm.mjs doctor --json

# Framework version
node atm.mjs --version
```

Source-first framework validation only:

```shell
node atm.dev.mjs next --prompt "<current user prompt>" --json
```

## Token-efficient governance runs

- Redirect build, close, and sweep output to a log file. Read only the exit code
  plus the `ATM-RESULT` line, or `tail -5` of the log.
- Use `ATM_BUILD_LOG_FILE=/tmp/atm-build.log npm run build` and
  `ATM_SWEEP_LOG_FILE=/tmp/atm-sweep.log node --strip-types scripts/run-cli-test-sweep.ts`
  for summary output.
- Use `taskflow close ... --summary --output-json /tmp/atm-close.json` instead
  of plain `--json`. These global flags project a compact result and write that
  projected JSON to the file; they do not save the full evidence envelope.
- After merging main, run `npm run preclose:check` before `taskflow close --write`.
- Run long closes detached: `setsid nohup node atm.mjs taskflow close ... --write --summary --output-json /tmp/atm-close.json > /tmp/atm-close.log 2>&1 < /dev/null &`
  (replace `...` with the task, actor, and required playbook arguments).
- Recover interrupted closes with `taskflow close ... --recover` or `--abort`.
  Run the dry-run first (omit `--write`), inspect the recovery result, then repeat
  with `--write`; recovery requires the prior holder to be gone. Abort is refused
  after a close has landed.
- Wait for CI once with `gh pr checks <pr> --watch --interval 120` instead of polling.
