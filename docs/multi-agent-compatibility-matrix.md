# Multi-Agent Compatibility Matrix

This matrix defines the advisory confidence workflow for ATM multi-agent compatibility.

The confidence gate is not an alpha0 release blocker. It exists to show whether the official bootstrap prompt, AGENTS instructions, and deterministic self-hosting proof remain model-neutral across common agent envelopes.

| Agent | Profile ID | Confidence Source | Alpha0 Blocker |
| --- | --- | --- | --- |
| Claude Code | `claude-code` | `atm self-host-alpha --verify --agent claude-code --json` | no |
| Cursor | `cursor` | `atm self-host-alpha --verify --agent cursor --json` | no |
| Aider | `aider` | `atm self-host-alpha --verify --agent aider --json` | no |
| GitHub Copilot Agent | `github-copilot-agent` | `atm self-host-alpha --verify --agent github-copilot-agent --json` | no |
| OpenAI Assistants API | `openai-assistants-api` | `atm self-host-alpha --verify --agent openai-assistants-api --json` | no |

All profiles also require `atm verify --agents-md --json` to confirm that the bootstrap instructions remain vendor-neutral and do not depend on IDE-specific slash commands.

If a profile fails in the future, record the failure in `docs/multi-agent-results.md`, link the follow-up issue, and decide separately whether it blocks alpha1.