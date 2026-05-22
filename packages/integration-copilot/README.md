# @ai-atomic-framework/integration-copilot

GitHub Copilot adapter for ATM instructions and prompts.

The adapter installs ATM instruction and prompt files under `.github/instructions/` and `.github/prompts/`. It does not overwrite `.github/copilot-instructions.md`, because that file often carries host-project rules that must stay authoritative. Every installed file renders the current repository charter invariants, starts from the ATM next command, is hash-recorded in the install manifest, and is preserved if edited before uninstall. The framework-neutral source templates still keep `{{CHARTER_INVARIANTS}}` until install time.
