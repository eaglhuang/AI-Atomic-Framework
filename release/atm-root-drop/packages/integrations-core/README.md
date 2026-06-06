# @ai-atomic-framework/integrations-core

Integration adapter contracts for ATM agent entrypoint delivery.

This package defines the `IntegrationAdapter` interface, the `InstallManifest` type, SHA-256 helpers, shared skill template compilers, and the Codex skills adapter helper. Adapters install agent-native entry files, record the installed file hashes, verify drift, and uninstall only files whose hashes still match the manifest.

Official adapters live in sibling packages such as `integration-claude-code`, `integration-codex`, `integration-copilot`, `integration-cursor`, and `integration-gemini`. The legacy `createCodexSkillsAdapter()` helper remains as a low-level factory for repo-local Codex skill surfaces; user-facing installs should go through `atm integration add codex`.
