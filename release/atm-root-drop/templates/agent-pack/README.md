<!-- doc_id: doc_templates_agent_pack_readme -->
# Agent-pack templates

This directory holds **reusable playbook fragments** that every editor
integration adapter (Claude Code, Codex, Copilot, Cursor, Gemini,
Antigravity/Windsurf) must reference instead of duplicating their own
ATM-flow instructions.

The canonical full playbook lives at `docs/governance/batch-playbook.md`.
These fragments are the short, per-channel command sequences extracted
from that playbook so editor skill manifests can include them verbatim.

## Files

| File | Use when |
|---|---|
| `batch-playbook-fragment.md` | Agent is in an active `batchId`. |
| `normal-playbook-fragment.md` | Agent is on one explicit task card. |
| `fast-playbook-fragment.md` | Small low-risk edit; no task card. |

## Drift guard

`node atm.mjs integration verify <adapter> --json` checks that each
adapter's installed skill files match the manifest. If an adapter
hand-edits its own playbook content and diverges from these fragments,
the verify command should report entry drift.

## Update policy

When the runtime playbook in `packages/cli/src/commands/next.ts`
(`buildChannelPlaybook`) changes:

1. Update `docs/governance/batch-playbook.md` first.
2. Then update the matching fragment here.
3. Then re-render adapter skill files and run
   `node atm.mjs integration verify <adapter>` for each editor.

The opposite order — touching adapter files first — is a known cause of
silent drift and must be avoided.
