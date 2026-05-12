# Claude Code Slash Commands (Opt-In)

This folder is an optional example for teams that want project-local slash commands.

It is not required for ATM operation. The official contract remains:

```text
Read README.md if present, then run "node atm.mjs next --json" from the repository root and execute exactly the returned next action.
```

## Quick Setup

1. Copy commands into your target repository:

```bash
mkdir -p .claude/commands
cp examples/claude-code-slash-commands/.claude/commands/*.md .claude/commands/
```

2. Open your Claude Code session and run `/help` to verify commands are available.

## Included Commands

- `/atm-next`: Route through `node atm.mjs next --json`.
- `/atm-bootstrap`: Bootstrap ATM only when the repository is not initialized.
- `/atm-verify`: Run quick governance verification checks.

## Notes

- Keep these commands as opt-in helpers; do not treat them as required ATM runtime files.
- Customize command wording for your team if needed, while preserving the `next --json` contract.
