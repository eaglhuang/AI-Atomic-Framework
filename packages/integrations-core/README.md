# @ai-atomic-framework/integrations-core

Integration adapter contracts for ATM agent entrypoint delivery.

This package defines the `IntegrationAdapter` interface, the `InstallManifest` type, SHA-256 helpers, and a Codex skills adapter factory used as the first reference implementation. Adapters install agent-native entry files, record the installed file hashes, verify drift, and uninstall only files whose hashes still match the manifest.
