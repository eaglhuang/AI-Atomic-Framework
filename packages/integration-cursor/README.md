# @ai-atomic-framework/integration-cursor

Cursor adapter for ATM agent entry skills.

The adapter installs the minimum ATM entry skill set under `.cursor/rules/skills/atm-*/SKILL.md`, renders the current repository charter invariants into every installed skill, records SHA-256 hashes in the install manifest, and preserves edited files during uninstall. The framework-neutral source templates still keep `{{CHARTER_INVARIANTS}}` until install time.
