# @ai-atomic-framework/integration-copilot

GitHub Copilot adapter for ATM instructions and prompts.

The adapter installs `.github/copilot-instructions.md`, plus ATM instruction and prompt files under `.github/instructions/` and `.github/prompts/`. Every installed file contains the charter invariants placeholder, starts from the ATM next command, is hash-recorded in the install manifest, and is preserved if edited before uninstall.
