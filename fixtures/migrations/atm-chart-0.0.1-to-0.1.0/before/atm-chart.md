---
atm_chart_version: 0.0.1
framework_version: 0.0.0
template_version: 0.1.0
min_framework_version: 0.0.0
---
# ATMChart

## Core Guard Summary
- `preserve-host-workflow`: Do not invent a build step, package manager, or runtime workflow that the host repository does not already use.
- `lock-before-edit`: Create or respect a scope lock before editing files outside the bootstrap pack.
- `evidence-after-change`: Record validation evidence and a short context summary before declaring the task done.
- `protect-context-budget`: When estimated context load exceeds the repository policy, summarize or offload before continuing.

## Official Entry Route
- Run `node atm.mjs next --json` and follow the returned action.
