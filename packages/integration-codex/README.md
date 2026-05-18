# @ai-atomic-framework/integration-codex

Codex adapter for ATM skills.

The adapter installs repo-local Codex skill files under `integrations/codex-skills/`. Every installed file starts from the ATM next command, records its hash in `.atm/integrations/codex.manifest.json`, and is preserved if edited before uninstall.

`atm guide install-skill --target codex` remains the optional bridge for installing skills into a user's global Codex skills root. It does not replace this repository-local integration adapter.
