---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-internal-build-sync
title: ATM Internal Build Sync
summary: Build the ATM framework runner and sync it to explicit internal adopter repositories with skip/exclude controls.
command: node atm.mjs internal-release sync $ARGUMENTS --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

Use this skill when the user asks to build an ATM framework version and sync the
fresh runner into internal repositories.

## First Command

```bash
{{firstCommand}}
```

Then inspect framework-development mode before release mutation:

```bash
node atm.mjs framework-mode status --json
node atm.mjs guard framework-development --json
```

## Sync Command

Pass every target repository explicitly. Do not bake adopter repository names
into framework source.

```bash
node atm.mjs internal-release sync --repo <repo-a> --repo <repo-b> --json
```

To intentionally skip one repository, match either its basename or full path:

```bash
node atm.mjs internal-release sync --repo <repo-a> --repo <repo-b> --skip <repo-b-name> --json
```

Useful switches:

- `--dry-run`: show what would be copied without writing target repos.
- `--no-build`: reuse the existing `release/atm-onefile/atm.mjs`.
- `--no-verify`: copy without running target `doctor`, `framework-mode status`, and `tasks audit`.
- `--allow-verify-failure`: copy and report verification failures without failing the command.

## Required Evidence

Capture the command JSON evidence, including:

- `sourceSha256`
- each target `previousSha256` and `newSha256`
- skipped targets and skip reason
- target verification command hashes and exit codes

Do not manually copy `atm.mjs` to target repositories when this command is
available.

{{CHARTER_INVARIANTS}}
