# @ai-atomic-framework/integration-gemini

Gemini CLI adapter for ATM agent entry commands.

The adapter installs the minimum ATM entry command set under `.gemini/commands/atm-*.toml`, injects the charter invariants placeholder into every command file, records SHA-256 hashes in the install manifest, and preserves edited files during uninstall.
