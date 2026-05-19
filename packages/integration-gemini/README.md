# @ai-atomic-framework/integration-gemini

Gemini CLI adapter for ATM agent entry commands.

The adapter installs the minimum ATM entry command set under `.gemini/commands/atm-*.toml`, renders the current repository charter invariants into every installed command file, records SHA-256 hashes in the install manifest, and preserves edited files during uninstall. The framework-neutral source templates still keep `{{CHARTER_INVARIANTS}}` until install time.
