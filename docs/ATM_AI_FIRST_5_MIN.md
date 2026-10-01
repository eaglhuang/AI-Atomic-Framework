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

## 4. Leave evidence and finish

- Run the validators the playbook names and record them with `node atm.mjs evidence run ... --json`.
- Close through the command the playbook gives you; do not edit `.atm/` files by hand.
- Report the changed files and the evidence path to the user.

## Which version to pin

- npm packages (`@ai-atomic-framework/cli`, `create-atm`) carry the product version; pin those.
- `welcome --json` reports the same `frameworkVersion` for the runner you are using.
- Git tags such as `v0.9.0-alpha.1` mark paper and research snapshots, not the installable product version.
