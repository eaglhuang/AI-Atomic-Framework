# create-atm

Create an ATM project and run the first governed write. Checked on npm 0.1.20.

## Install

Node 20+. This runs `git init` and the first commit (`chore: initialize ATM project`). Set Git `user.name` and `user.email` first:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
npx --yes create-atm@latest my-app --agent cursor --json
```

If the command fails at `initial commit` (`ATM_CREATE_FAILED`, files kept), finish it inside `my-app`:

```bash
cd my-app
git config user.name "Your Name"
git config user.email "you@example.com"
git add -A
git commit -m "chore: initialize ATM project"
```

Other `--agent` ids: `claude-code`, `codex`, `copilot`, `gemini`, `antigravity`. Omit `--agent` for a CLI-only project. The success JSON lists `steps` only. It does not include a next command.

An existing git repository uses `@ai-atomic-framework/cli` `setup`, not `create-atm`. Keep that CLI install at a stable path:

```bash
npm install --prefix ~/atm-runner @ai-atomic-framework/cli@latest
node ~/atm-runner/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs setup --cwd /absolute/path/to/existing-repo --agents cursor --json
```

## Version pin

After install, `node atm.mjs welcome --json` reports `evidence.versions.frameworkVersion`. Pin that npm version (0.1.20 when this was checked). `evidence.versions.releaseTrain.frameworkVersion` was `0.0.0`; do not pin to it. Git tags such as `v0.9.0-alpha.1` are paper snapshots, not this package.

## First governed write

Day-1 commands are `welcome`, `next`, `taskflow`, `evidence`, and `doctor`. From `my-app`:

**Empty queue: skip `guide`, `orient`, and `start`.** **Trust the playbook over a conflicting `nextAction.command`.** **Replace every `<...>` placeholder; this block has none.** **Do not dump the JSON; use `jq`.**

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

`close --write` needs Git `user.name` / `user.email` and the playbook's `--lane-session`. A missing Git author is `ATM_CLI_UNHANDLED` and does not suggest `identity set`. ATM actor identity and the Git author are different. Captain, dispatch, and wave flows are day 2+.
