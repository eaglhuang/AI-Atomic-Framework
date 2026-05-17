# Agent Onboarding Flow Example

This example proves the framework-neutral integration path for ATM agent entry files.

It installs and verifies three agent adapters in a temporary host repository:

- Claude Code (`claude-code`)
- Cursor (`cursor`)
- GitHub Copilot Agent (`copilot`)

The smoke checks confirm that each adapter install writes an install manifest, verifies cleanly, preserves the required first command (`node atm.mjs next --json`), and injects the AtomicCharter placeholder into generated entry files.

The example also validates that a charter conflict fixture is rejected by the charter invariants schema. This keeps the demo focused on ATM framework contracts instead of any host-specific onboarding flow.

Run it from the repository root:

```bash
node --experimental-strip-types examples/agent-onboarding-flow/run.ts
```

Expected smoke marker:

```text
[example:agent-onboarding-flow] ok
```