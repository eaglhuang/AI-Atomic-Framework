---
schema_version: atm.atmChart.v0.1
atm_chart_version: 0.1.0
framework_version: 0.1.0
template_version: 0.1.0
min_framework_version: 0.0.0
source_guards_path: .atm/runtime/default-guards.json
source_guards_sha256: sha256:5943cbd95c16aa9f974259aae2162170b876c0806375c6cf386d03f7018c44a7
source_schema_sha256s: {"governance/default-guards":"sha256:8d3a6d2b99a51890653ab36669cb725dc4cec7c914abd4145794861a7841d888","charter/charter-invariants":"sha256:15557a166f149d74567acf10676997e4ea89943075846ad3dab641d1b072a381","integrations/install-manifest":"sha256:b5f67b165601fd9da11864de78252141f74c540f55d9a6fd7c40f1e8afffeecc","agent-prompt":"sha256:1ff8806e3c104f17a0d7d8bbf6b436fffa0200357c8434896665fc208bfb7028","upgrade/upgrade-proposal":"sha256:971755cd4e3262c488a2ba7c98e6ddb2640a90686b960de8e167a0854953ed87"}
---
# ATMChart

## Core Guard Summary
- `preserve-host-workflow`: Do not invent a build step, package manager, or runtime workflow that the host repository does not already use.
- `lock-before-edit`: Create or respect a scope lock before editing files outside the bootstrap pack.
- `evidence-after-change`: Record validation evidence and a short context summary before declaring the task done.
- `protect-context-budget`: When estimated context load exceeds the repository policy, summarize or offload before continuing.
- `framework-work-tracking-stays-downstream`: Do not create or keep coordinating implementation task cards or project planning queues inside the framework repository; keep them in the coordinating host workspace and feed upstream only neutral evidence, fixtures, schemas, or validators.
- `public-framework-docs-remain-english-only`: Keep contributor-facing framework documentation English-only and repository-neutral; move non-English notes or local planning guidance to the coordinating host workspace.

## Source of Truth
- Guards: `.atm/runtime/default-guards.json`
- `governance/default-guards` -> `schemas/governance/default-guards.schema.json` (sha256:8d3a6d2b99a51890653ab36669cb725dc4cec7c914abd4145794861a7841d888)
- `charter/charter-invariants` -> `schemas/charter/charter-invariants.schema.json` (sha256:15557a166f149d74567acf10676997e4ea89943075846ad3dab641d1b072a381)
- `integrations/install-manifest` -> `schemas/integrations/install-manifest.schema.json` (sha256:b5f67b165601fd9da11864de78252141f74c540f55d9a6fd7c40f1e8afffeecc)
- `agent-prompt` -> `schemas/agent-prompt.schema.json` (sha256:1ff8806e3c104f17a0d7d8bbf6b436fffa0200357c8434896665fc208bfb7028)
- `upgrade/upgrade-proposal` -> `schemas/upgrade/upgrade-proposal.schema.json` (sha256:971755cd4e3262c488a2ba7c98e6ddb2640a90686b960de8e167a0854953ed87)

## Official Entry Route
- Run `node atm.mjs next --json` and follow the returned action.
