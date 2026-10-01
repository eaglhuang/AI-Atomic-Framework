# ATM Documentation Map

Most of this directory is reference or advanced material. A new AI agent or a new user only needs the first section.

## Start here (day one)

| Document | Read it when |
| --- | --- |
| [`ATM_AI_FIRST_5_MIN.md`](ATM_AI_FIRST_5_MIN.md) | You are an AI agent doing user work in an ATM repository. This is the only required read. |
| [`QUICK_START.md`](QUICK_START.md) | You want to try ATM from a clone of this repository. |
| [`AGENT_PACK_ONBOARDING.md`](AGENT_PACK_ONBOARDING.md) | You are installing or checking an editor integration. |

## Advanced workflows

Skip these until a task actually needs them.

| Document | Topic |
| --- | --- |
| [`ATM_NEW_USER_WORKFLOW.md`](ATM_NEW_USER_WORKFLOW.md) | Two-repository taskflow (planning repo + target repo) with `taskflow.profile.json`. |
| [`SELF_HOSTING_ALPHA.md`](SELF_HOSTING_ALPHA.md) | Self-hosting checklist and `next --json` state semantics. |
| [`TEAM_AGENTS_WAVE_MODE.md`](TEAM_AGENTS_WAVE_MODE.md) | Running several agents in waves. |
| [`BROKER_GUIDE.md`](BROKER_GUIDE.md) | Shared-file write broker and compose rules. |
| [`HOST_GOVERNANCE_INTEGRATION.md`](HOST_GOVERNANCE_INTEGRATION.md) | Integrating ATM with an existing host governance setup. |
| [`ADAPTER_GUIDE.md`](ADAPTER_GUIDE.md) | Writing adapters and plugins. |

## Reference

| Document | Topic |
| --- | --- |
| [`ERROR_CODES.md`](ERROR_CODES.md) | Every `ATM_*` code with meaning and remediation. |
| [`DIST_TAGS.md`](DIST_TAGS.md) | npm dist-tag policy. |
| [`VERSION_SKEW.md`](VERSION_SKEW.md) | Supported version combinations. |
| [`LIFECYCLE.md`](LIFECYCLE.md), [`EVIDENCE_LEDGER.md`](EVIDENCE_LEDGER.md), [`TELEMETRY.md`](TELEMETRY.md) | Task lifecycle, evidence storage and telemetry policy. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Package and runtime architecture. |

Everything else in `docs/` (including `governance/` and `ai_atomic_framework/`) is maintainer material for developing ATM itself.
