# Conversation Learning Loop Example

This example demonstrates the ATM conversation-derived learning loop:

```text
redacted transcript -> review findings -> immediate feedback choices -> dry-run patch drafts -> governed review
```

The demo covers the user-facing choice policy from M13:

- `Y` routes a finding to dry-run draft creation.
- `N` records evidence and recurrence, then asks again on recurrence.
- `X` records evidence but suppresses future prompts for the same suppression key.

It also verifies the M14 bridge still produces governed dry-run outputs: one Atom patch draft, skill patch drafts, a blocked dry-run route when the base Atom version is missing, and no automatic mutation.

## Running

```bash
node --experimental-strip-types examples/conversation-learning-loop/run.ts
# -> [example:conversation-learning-loop] ok (...)
```

## Related Docs

- `docs/ATOM_EVOLUTION_PLAN.md` - M13 and M14 plan.
- `packages/plugin-sdk/src/conversation/conversation-feedback-loop.ts` - immediate feedback and user choice contract.
- `packages/plugin-sdk/src/conversation/conversation-patch-draft-bridge.ts` - dry-run patch draft bridge.