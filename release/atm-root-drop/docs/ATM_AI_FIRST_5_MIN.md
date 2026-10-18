# ATM: The First Five Minutes for an AI Agent

This is the only document a new AI agent needs before doing user work in an ATM repository. Day 1 uses five commands: `welcome`, `next`, `taskflow`, `evidence`, `doctor`. Captain, dispatch, wave, batch, and team flows are day 2 or later.

## 1. Get a runnable ATM in the repository

New project (Node 20+). `create-atm` runs `git init` and the first commit, so Git `user.name` and `user.email` must already be set (`git config --global user.name` and `git config --global user.email`):

```bash
npx --yes create-atm@latest my-app --agent cursor --json
```

If that fails at `initial commit` (`ATM_CREATE_FAILED`), the files are kept. From `my-app`: `git config user.name`, `git config user.email`, `git add -A`, then `git commit -m "chore: initialize ATM project"`.

Existing repository: keep the CLI at a stable path and run `setup`. The generated `atm.mjs` stores that absolute path.

```bash
npm install --prefix ~/atm-runner @ai-atomic-framework/cli@latest
node ~/atm-runner/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs setup --cwd /absolute/path/to/existing-repo --agents cursor --json
```

Building or testing the ATM framework repository itself requires Node 24. Runtime adopters can use Node 20 or newer.

## 2. Read the version, then do the first write

```bash
node atm.mjs welcome --json
```

Read `evidence.versions.frameworkVersion` and pin that npm version. On 0.1.20, `evidence.versions.releaseTrain.frameworkVersion` is `0.0.0`; do not pin to it. Git tags such as `v0.9.0-alpha.1` are paper snapshots, not the npm package. If the result contains `ATM_USER_NOTICE` or `evidence.userNotice`, tell the user in one or two sentences before continuing.

**Empty queue: skip `guide`, `orient`, and `start`.** `next --prompt` with no task card returns a prefilled `taskflow open`. Until `--actor`, `--scope-path`, and `--validator` are known, that command is a dry-run and names the missing flags. Do not follow `guide`. `welcome` and `doctor` on a project with no `scripts.test` point at `doctor --json`, not `npm test --if-present`. Those are not the first write.

**Trust the playbook.** After claim, `nextAction.command` is `implement-deliverables`, the same sentinel as `playbook.commandSequence[0]`. It means edit the declared files. It is not a shell command, and pasting it does not run `start`. Run the playbook lines extracted below.

**Replace every `<...>` placeholder before pasting.** Unquoted `<id>` is a shell redirect.

**Do not dump the JSON.** Redirect it and use `jq`.

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

The card is `docs/tasks/<task-id>.task.md` (the id is `evidence.generation.taskId`, not a name you invent). Edit only the scope you declared. The playbook's first line, `implement-deliverables`, is that file edit, not a command. `pre-close` and the dry-run `close` are listed and are optional for this hello.txt path. `close --write` must keep the playbook's `--lane-session`.

## 3. Git author versus ATM identity

`taskflow close --write` commits the deliverables and the governance bundle as one git commit. That commit needs Git's `user.name` and `user.email`.

On 0.1.20, a missing Git author fails with `ATM_CLI_UNHANDLED` and the raw `git commit` error. The JSON does not include an `identity set` recovery command. Do not wait for one.

Git author identity and ATM actor identity are different. `node atm.mjs identity set` records an ATM actor profile. It is not the repair for this failure. Set the Git author in the project and retry the same playbook close line:

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

`doctor --json` is the day-1 health check. Do not edit `.atm/` files by hand. Report the changed files and `.atm/history/evidence/<task-id>.bundle-manifest.json`. A successful close can still leave `.atm/runtime/welcome.lineage.json` untracked after `welcome`.
