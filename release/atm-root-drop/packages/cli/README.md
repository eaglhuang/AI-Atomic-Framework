# @ai-atomic-framework/cli

Day-1 install and first governed write for ATM. Checked against npm 0.1.20 (`welcome` field `evidence.versions.frameworkVersion`). Commands below are what that release actually runs.

## New project

`create-atm` is the newcomer entry. It installs this CLI, runs `git init`, and makes the first commit. Set Git `user.name` and `user.email` first (`git config --global user.name` / `git config --global user.email`). If the initial commit fails, the files are kept: set the Git author inside the project, `git add -A`, and `git commit -m "chore: initialize ATM project"`.

```bash
npx --yes create-atm@latest my-app --agent cursor --json
```

## Existing repository

Keep this install at a stable path. `setup` writes that path into the project's `atm.mjs`.

```bash
npm install --prefix ~/atm-runner @ai-atomic-framework/cli@latest
node ~/atm-runner/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs setup --cwd /absolute/path/to/existing-repo --agents cursor --json
```

## Version pin

Pin `evidence.versions.frameworkVersion` from `node atm.mjs welcome --json`. On 0.1.20, `evidence.versions.releaseTrain.frameworkVersion` is `0.0.0`; do not pin to it. Git tags such as `v0.9.0-alpha.1` are paper snapshots, not this package.

## First governed write

Day-1 commands: `welcome`, `next`, `taskflow`, `evidence`, `doctor`. From the project root:

**Empty queue: skip `guide`, `orient`, and `start`.** **After claim, `nextAction.command` is `implement-deliverables`**, the same sentinel as `playbook.commandSequence[0]`. It is the file edit, not a shell command. **Replace every `<...>` placeholder; this block has none.** **Do not dump the JSON; use `jq`.**

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

`close --write` commits the deliverables. It needs the playbook's `--lane-session` and Git `user.name` / `user.email`. A missing Git author is `ATM_CLI_UNHANDLED` with no `identity set` hint. ATM `identity set` is an actor profile, not that Git author. Captain, dispatch, and wave flows are day 2+.
