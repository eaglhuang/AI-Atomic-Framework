# ATM: The First Five Minutes for an AI Agent

This is the only document a new AI agent needs before doing user work in an ATM repository. Everything else (taskflow, broker, team agents, release flow) is advanced material you can skip on day one.

## 1. Get a runnable ATM in the repository

Pick one:

| Situation | Command |
| --- | --- |
| New project | `npx create-atm <app> --agent <cursor\|claude-code\|codex\|copilot\|gemini\|antigravity> --json` |
| Existing repository | Copy `release/atm-onefile/atm.mjs` to the repository root, then `node atm.mjs bootstrap --json` |
| Existing repository with npm | `npm install --save-exact @ai-atomic-framework/cli`, then `npx atm bootstrap --json` |

`bootstrap` also renders the ATMChart (`.atm/memory/atm-chart.md`). If your editor integration is not installed yet, run `node atm.mjs integration add <editor-id> --json`.

Runtime adopters can use Node 20 or newer. Building or testing the ATM framework repository itself requires Node 24.

## 2. Orient once

```bash
node atm.mjs welcome --json
```

If the result contains `ATM_USER_NOTICE` or `evidence.userNotice`, tell the user in one or two sentences before continuing.

## 3. Route the user request

```bash
node atm.mjs next --prompt "<the user's request>" --json
```

- Use `--prompt` for any user-requested work. `node atm.mjs next --json` without a prompt is read-only orientation; in a repository that already has task cards it answers `prompt-required`, which is expected.
- Read `evidence.nextAction.playbook` and the returned scope before editing.
- Execute the single command ATM returns (for example a claim), then do the work inside the allowed files.

### Ordinary work without a task card

Bootstrap gives every project a `taskflow.profile.json`, so you can open the task card yourself. Turn the request into a title, a one-paragraph goal, the files you will change, and the command that proves the change, then:

```bash
node atm.mjs taskflow open --write --actor <id> --title "<title>" --goal "<goal>" --scope-path "<file>,<file>" --validator "<command>" --json
node atm.mjs next --claim --actor <id> --task <TASK-ID> --auto-intent --json
```

The card is written to `docs/tasks/<TASK-ID>.task.md` and is your delivery contract: edit only its `scopePaths`, and open another card instead of widening the scope. Planning repositories are only for developing ATM itself.

The claim response's playbook lists every later command with `--lane-session <id>` already appended. Keep that flag: each shell starts without the claim's lane, and mutations without it are refused.

## 4. Leave evidence and finish

- Run the validators the playbook names and record them with `node atm.mjs evidence run ... --json`.
- Commit with `node atm.mjs git commit --task <TASK-ID> ... --lane-session <id> --json`. The first commit may ask you to run `identity set` once.
- Close through the command the playbook gives you (`taskflow close` dry-run, then the `--write` command its `writeReadinessHint` names); do not edit `.atm/` files by hand.
- Report the changed files and the evidence path to the user.

## Which version to pin

- npm packages (`@ai-atomic-framework/cli`, `create-atm`) carry the product version; pin those.
- `welcome --json` reports the same `frameworkVersion` for the runner you are using.
- Git tags such as `v0.9.0-alpha.1` mark paper and research snapshots, not the installable product version.
