# ATM Governance Router Learning Loop

Use this reference when `atm-governance-router` worked, but the agent still
felt friction, confusion, or nearly bypassed ATM.

Goal: turn repeated wall-hits into a better entry skill without filling the
main `SKILL.md` with noise.

Shared taxonomy, capture fields, and promotion semantics are defined in
`docs/governance/skills/shared-growth-contract.md`. This file is the
router-local projection of that shared contract.

## What To Capture

Capture only cases that are reusable across ATM work, not one-off repo trivia.

Good capture targets:

- first-touch entry confusion;
- repeated misunderstanding of `next`, `playbook`, `framework-mode`, or claim;
- blockers that need a shorter mnemonic rule;
- fallback rules that should become explicit.

Do not capture:

- private project details better kept in repo docs;
- one-time user preference;
- noise that did not change the routing decision.

## Fast Capture Template

Record the lesson in this shape:

```md
## YYYY-MM-DD - short title

- Trigger: what kind of prompt or repo state caused the problem
- Symptom: what the agent almost did wrong or found confusing
- Correct ATM route: the exact safer route
- Durable rule: one short sentence worth reusing
- Promotion target:
  - `SKILL.md` if this changes the core entry contract
  - `learning-loop.md` if this is still a pattern/example
  - repo docs if this is host-specific
```

## Promotion Rules

Promote a lesson from this reference into `SKILL.md` when one of these is true:

1. The same mistake happened at least twice.
2. The mistake risks ATM bypass, unsafe edits, or wrong close/commit order.
3. The fix can be expressed as a short general rule with broad value.

Keep `SKILL.md` short. Promote the rule, not the whole story.

## Demotion Rules

Keep the active learning loop lean.

Move a lesson out of the active section and into a historical section when:

1. the related bug is fixed or the route is no longer current;
2. the lesson no longer changes the default routing decision;
3. keeping it active would mostly add token cost or confusion.

When that happens:

- keep only the durable current rule in active guidance, if any remains;
- move the wall-hit story to a historical note for traceability;
- remove obsolete workaround wording from active router guidance.

## Suggested Learning Categories

### Entry Friction

- The agent did not realize this skill is the default ATM entrypoint.
- The agent jumped into local reads/edits before `next`.

### Route Interpretation

- The agent saw `no-work`, `task-no-work`, `framework-temp-claim-required`, or
  `playbook required` and misread what to do next.

### Boundary Confusion

- The agent mixed planning-repo work with target-repo execution.
- The agent missed a framework-temp claim requirement.

### Fallback Design

- A tool-first path failed and the CLI fallback rule was unclear.
- A fallback existed, but the agent used a weaker or noisier path than needed.

### Team Routing

- The router started absorbing playbook or role-pack behavior that should stay
  outside first-touch entry.
- A Team Agent role was selected without a clear playbook slice or authority
  boundary.

## Seed Lessons From Current Dogfood Backlog

## 2026-06-23 - Imported batch already exists but claim path keeps searching

- Category: entry-friction
- Trigger: prompt-scoped SKL batch is already imported into the JSON task ledger
- Symptom: `next --claim` keeps spending time on planning-root discovery or
  extra orchestration instead of converging quickly on the imported queue head
- Correct ATM route: if imported prompt-scoped tasks already exist, trust the
  governed task ledger first and only escalate to planning-root discovery when
  the ledger truly lacks the requested lane
- Durable rule: imported task truth should beat repeated rediscovery
- Promotion target: learning-loop.md now, `SKILL.md` if repeated
- Backlog link: `ATM-BUG-2026-06-23-019`

## 2026-06-23 - Planning repo says done but target repo still blocks on stale import

- Category: boundary-confusion
- Trigger: planning-repo task was reconciled or closed, but the target repo
  keeps evaluating an older imported snapshot
- Symptom: downstream claim is blocked by a dependency that is already done in
  the planning source of truth
- Correct ATM route: compare planning truth and imported target snapshot before
  assuming the dependency blocker is real; if stale, use the governed refresh
  path instead of random lifecycle retries
- Durable rule: cross-repo dependency blockers must be checked for stale import
  truth before escalation
- Promotion target: learning-loop.md now, `SKILL.md` if repeated
- Backlog link: `ATM-BUG-2026-06-23-020`

## 2026-06-23 - Host runner and framework runner expose different operator surfaces

- Category: tooling-mismatch
- Trigger: adopter repo frozen runner and framework source/frozen runner are on
  different capability levels during closeback or evidence work
- Symptom: one repo has `taskflow` or `evidence run`, the other does not, so
  the operator bounces between contradictory routes
- Correct ATM route: diagnose runner capability parity before treating the
  command failure as a normal lifecycle blocker
- Durable rule: when command surfaces differ across repos, suspect runner skew
  before retrying lifecycle operations
- Promotion target: learning-loop.md now, `SKILL.md` if repeated
- Backlog link: `ATM-BUG-2026-06-23-021`

## 2026-06-24 - Source-first pass is not frozen-runner proof

- Category: tooling-mismatch
- Trigger: a dogfood fix changes `CLI`, `close`, `taskflow`, `hook`, or
  `evidence` behavior, and the operator wants to verify the frozen runner path
- Symptom: the agent sees `node atm.dev.mjs` or source tests pass and almost
  concludes that `node atm.mjs` is already updated too
- Correct ATM route: if the proof target is the frozen runner, run
  `ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build`, then rerun the frozen
  entrypoint and judge success from that result
- Durable rule: source-first success is not frozen-runner proof
- Promotion target: learning-loop.md now, `SKILL.md` if repeated
- Backlog link: `ATM-BUG-2026-06-24-022`

## Historical Section

Use this section for lessons that were once important for routing safety but no
longer need to be loaded as active dogfood guidance after the underlying fix is
stable. Keep each entry short and link it back to the original backlog item or
fixing task/commit when available.

When `ATM-BUG-2026-06-24-022` is fixed and retained-build frozen validation is
either automated or surfaced as a first-class guard, move the 2026-06-24
runner-proof lesson here and keep only the stable post-fix rule in active
guidance.

## Quality Bar

A useful learning item should make a future agent faster or safer within a few
seconds of reading it.

If the lesson needs a long essay to explain, it probably belongs in repo docs,
not in this skill.
