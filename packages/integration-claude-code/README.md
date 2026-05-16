# @ai-atomic-framework/integration-claude-code

Claude Code adapter for ATM agent entry skills.

The adapter installs the minimum ATM entry skill set under `.claude/skills/atm-*/SKILL.md`, injects the charter invariants placeholder into every skill, records SHA-256 hashes in the install manifest, and preserves edited files during uninstall.
