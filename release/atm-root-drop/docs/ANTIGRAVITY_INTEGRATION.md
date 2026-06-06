# Antigravity Integration

Antigravity is supported as a first-class ATM integration adapter.

Install and verify:

```bash
node atm.mjs integration add antigravity --json
node atm.mjs integration verify antigravity --json
```

Primary entry path:

- `GEMINI.md`

Installed ATM command skills:

- `.agents/skills/atm-next/SKILL.md`
- `.agents/skills/atm-orient/SKILL.md`
- `.agents/skills/atm-governance-router/SKILL.md`
- `.agents/skills/atm-create/SKILL.md`
- `.agents/skills/atm-lock/SKILL.md`
- `.agents/skills/atm-evidence/SKILL.md`
- `.agents/skills/atm-upgrade-scan/SKILL.md`
- `.agents/skills/atm-handoff/SKILL.md`

## How Antigravity Differs From Other Adapters

| Adapter | Primary entry | Skill/command surface |
| --- | --- | --- |
| Codex | `integrations/codex-skills/atm-governance-router/SKILL.md` | `integrations/codex-skills/atm-*/SKILL.md` |
| Claude Code | `.claude/skills/atm-governance-router/SKILL.md` | `.claude/skills/atm-*/SKILL.md` |
| Copilot | `.github/instructions/atm-governance-router.instructions.md` | `.github/instructions/*.instructions.md`, `.github/prompts/*.prompt.md` |
| Cursor | `.cursor/rules/skills/atm-governance-router/SKILL.md` | `.cursor/rules/skills/atm-*/SKILL.md` |
| Gemini | `.gemini/commands/atm-governance-router.toml` | `.gemini/commands/atm-*.toml` |
| **Antigravity** | `GEMINI.md` | `.agents/skills/atm-*/SKILL.md` |

Antigravity uses `GEMINI.md` as the root discovery document and keeps governed ATM routes in `.agents/skills`. Governance authority remains inside ATM CLI commands, not inside adapter files.
