---
mode: agent
description: Author ATM task cards with machine-readable scope, deliverables, validators, evidence, rollback, and atomization impact.
---


# ATM Task Card Authoring

Use this skill when creating or revising ATM task cards, plan follow-up tasks,
framework-development task cards, or default-governance plugin work items.

First command:

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

If the task card does not exist yet and `next` returns scope-not-found, continue
only as an authoring action. Do not claim unrelated open tasks.

When a task card introduces, renames, retires, explains, or repairs an `ATM_*`
code, route the code contract through `atm-error-code-resolver`. The source plan
and owning card must declare the code contract, and the designated registry
owner must update the shared registry instead of adding private error-code prose
to one skill.

## Highest Parallel Governance Principle

Use the Tier model as the first design boundary for any ATM task card that
affects concurrency, closeout, runner sync, build, git, release mirrors, or
broker/steward behavior:

- Reads never queue behind write lanes.
- Private writes to the actor's own ledger, evidence, notes, or planning
  artifacts never queue behind unrelated lanes.
- Shared writes to the git index, release mirrors, build artifacts, protected
  runtime state, or other shared mutation surfaces go through the broker, which
  answers with a ticket: execute now, enqueue with a position, or batch into a
  shared write window. A bare refusal at a shared-write gate is charter debt
  (INV-ATM-008), not a design choice.

The only standing serialization exceptions are the four owner-ruled cases in
`docs/governance/parallel-governance-charter.md` (one lane session per task
card; dependency gates block code only, never documents; the single-branch
commit core with related-task batching only; document writes are ungoverned,
code writes are always governed). Any new serialization point must be surfaced
to the project owner for an explicit ruling before it ships.

A card that introduces or preserves a queue must name the Tier 2 shared surface
that justifies serialization. A card that touches only Tier 0 or Tier 1 surfaces
must not require runner-sync, build, release-mirror, or git-index serialization
unless it also declares a concrete shared-surface intersection.

## Planning Authority Gate

Before creating a plan, task-card directory, or task card, classify the request
as one of:

- ATM framework implementation
- ATM governance optimization planning
- adopter or project work
- dogfood or backlog recording

Reserved family routing: ErrorCode and error-governance work must use the registered ERR family (series ERR, prefix TASK-ERR). Temporary cleanup, quarantine, and one-off residue-disposition work must use the registered TMP family (series TMP, prefix TASK-TMP). Do not spend GOV numbers on these categories. If a draft or ledger record already used a GOV id for ERR/TMP work, stop and reclassify it through the registered planning family and, when needed, a ledger rekey/realign repair before implementation continues.

Then resolve and state these three authorities:

- `planning authority`: repository that owns the human-readable plan and source
  task cards;
- `target authority`: repository where implementation files may change;
- `closure authority`: repository whose ATM ledger, evidence, close, and commit
  establish completion.

For ATM framework work that must be planned outside the target ATM ledger,
resolve an external governance workbench repository first. Do not assume the
current working directory is the planning repository.

Before writing any plan or task card, state these fields:

- `planning_repo_root`
- `planning_repo_is_external_to_target`
- `target_repo_root`
- `source_plan_path`
- `source_task_card_path`
- `target_import_method`

When planning and target authorities differ, keep the complete plan and source
cards only in the planning repository. The target repository may receive only
CLI-imported `.atm/history/**` ledger records and neutral product documentation
that is itself an explicit deliverable. Do not create a framework-local plan or
temporary card directory merely because implementation will happen there.

Treat an existing `planning_repo`, `related_plan`, AGENTS instruction, or human
decision as binding. If the authority is still unknown, stop authoring until it
is resolved. Memory and handoff notes are supporting context, not enforcement.

If no external governance workbench can be resolved for external-planning ATM
framework work, stop and ask the user for the planning repository, or record a
backlog item for missing planning-authority discovery. Do not create source
planning cards inside the ATM target repository by default.

When changing ATM skills, update the source-of-truth template files first.
Installed skill copies under agent or integration directories are derived
artifacts; direct-only edits to those copies are not sufficient and must fail
review because reinstalling or refreshing adapters can overwrite them.

## Cohesion-First Split Rule

TASK-SKL-0020 promoted this rule and TASK-SKL-0028 keeps it in the skill corpus
canary set: create follow-up cards by cohesive ownership before counting files
or estimating smallness. A card should own one behavior, interface, evidence
contract, or rollback boundary. If a "to-tickets" split would scatter one
behavior across several cards, keep the card whole or require a provider-neutral
review receipt that names the replaceable boundary.

For skill-template or integration projection cards, source templates are the
authority. Installed copies and adapter projections must come from a sealed
corpus source snapshot and must report source digest, compiler version,
degradation diagnostics, and manifest digest.

## Task Series Governance

Never invent a new task-series prefix (a new TASK-XXX family) on your own.
Before opening a card, survey the existing families in the target repository
task ledger and in the planning repository, and reuse the semantically closest
existing family at its next free id. Opening a brand-new series is only legal
after a complete written plan for that series has been approved by the project
owner. Every dispatch or card header must state which family was chosen and
why it is the closest match; a new prefix without an approved plan must be
rejected at review.

Series legitimacy check: a series is legitimate only if its parent
directory exists under the resolved planning repository / governance workbench
repo, for example `docs/ai_atomic_framework/<family-dir>/tasks/` within that
repo. A prefix that appears only in the target-repo ledger with no
planning-repo parent directory is itself an illegally invented series - do not
reuse it; report it to the owner and remap the work onto the correct family.
Task ids are assigned from the planning repository state, never inferred from
the local target-repo ledger.

Reserved family routing: ErrorCode and error-governance work must use the registered ERR family (series ERR, prefix TASK-ERR). Temporary cleanup, quarantine, and one-off residue-disposition work must use the registered TMP family (series TMP, prefix TASK-TMP). Do not spend GOV numbers on these categories. If a draft or ledger record already used a GOV id for ERR/TMP work, stop and reclassify it through the registered planning family and, when needed, a ledger rekey/realign repair before implementation continues.

## Required Card Contract

Every task card must include frontmatter or an equivalent machine-readable block:

```yaml
task_id: TASK-AREA-0001
title: Short action-oriented title
status: planned
owner: atm-release
priority: P0
depends_on: []
causalGraph:
  causalDependencies: []
  startConditions: []
  softRelations: []
  changedPublicSeams: []
  causalImpactEdges: []
  parallelFrontierInputs: []
  validatorReferences: []
  phaseOwner: null
related_plan: docs/path/to/work-record.md
planning_repo: <adopter-planning-repo>
target_repo: AI-Atomic-Framework
closure_authority: target_repo
scopePaths:
  - packages/cli/src/commands/example.ts
deliverables:
  - packages/cli/src/commands/example.ts
validators:
  - npm run validate:cli
# Causal validator contract (TASK-SKL-0022). Prefer these over bare command lists.
# responsibility values: task-required | phase-suite | advisory
testContributions:
  - caseId: test_task_example_behavior_8f3a2c1d
    targetGroupId: null
    semanticKey: example_behavior
    coversAcceptance: [ACC-1]
    coversImpactEdges: [example-public-seam]
    expectedRedPredicate: example failure is detected
    contributionResourceKey: null
    responsibility: task-required
    dependencyEdge: null
    contractEdge: example-contract
    resourceKey: null
requiredTestCaseIds:
  - test_task_example_behavior_8f3a2c1d
phaseTestCaseIds: []
advisoryTestCaseIds: []
# Case-ID-bound TDD lifecycle (TASK-SKL-0025).
# tddMode: required | recommended | reasoned-not-applicable
tddMode: required
tddNotApplicableReason: null
# mechanical/docs exemptions must be reviewed; they never inflate TDD success rate
tddExemptions: []
methodProfiles:
  - expand-contract
evidence:
  required: command-backed
rollback:
  strategy: revert-commit
atomizationImpact:
  ownerAtomOrMap: atm.cli-command-router-map
  mapUpdates:
    - atomic_workbench/maps/atm-cli-command-router-map.json
  extractionCandidates:
    - atom: atm.example-admission-policy
      pattern: Policy Object
      source: packages/cli/src/commands/example.ts
      disposition: extract   # extract | follow-up-card | inline
      inlineReason: null     # required when disposition is inline
errorCodes:
  - code: ATM_EXAMPLE_GUARD_BLOCKED
    disposition: register   # reuse | register | rename | retire
    category: guard
    trigger: Exact operator-actionable failure boundary
    retryable: true
    requiresHumanApproval: false
    recovery: node atm.mjs example status --json
    sourceOwner: packages/cli/src/commands/example.ts
    registryOwnerTask: TASK-AREA-0001
    tests:
      - tests/cli/example-error-code.test.ts
```

## Authoring Rules

- Keep planning context and target work separate:
  - `planning_repo` / `related_plan` are read-only context.
  - `target_repo`, `scopePaths`, and `deliverables` are the files an agent may
    actually change.
- Use explicit paths. Do not rely on prose acceptance text to define scope.
- Keep `depends_on` causal-only. Put readiness gates in `causalGraph.startConditions`
  and non-blocking links in `causalGraph.softRelations`.
- Declare public seams, causal impact edges, parallel-frontier inputs, validator
  references, and phase ownership under `causalGraph`, without duplicating prose.
- Include real non-ATM deliverables for code, data, pipeline, script, report, or
  artifact tasks. `.atm/history/**` is ledger state, not the deliverable.
- Include validators before the task is imported. If no validator exists yet,
  the task must say which validator must be created.
- When the card uses a recurring engineering method, declare the relevant
  `methodProfiles` id from `scripts/engineering-change-method-profiles.json`.
  Use the profile for trigger evidence, required observations, counterexamples,
  completion evidence, and rollback proof instead of restating a separate local
  checklist.
- Prefer the causal validator contract fields over command-only lists:
  - `testContributions` for shared/local case registration during the feature card;
  - `requiredTestCaseIds` for task-close obligations;
  - `phaseTestCaseIds` for batch/milestone/release suites;
  - `advisoryTestCaseIds` for non-blocking diagnostics.
- Contract responsibility must be one of `task-required`, `phase-suite`, or
  `advisory`. Broad full suites (`typecheck`, `validate:cli`, `*.static.all`)
  cannot be `task-required` unless the contribution declares a concrete
  dependency, contract, or resource edge.
- Every acceptance criterion and declared causal impact edge must resolve to at
  least one required case. Command-only legacy cards remain importable through
  an explicit advisory `legacy_cmd_*` projection plus
  `ATM_TASK_IMPORT_LEGACY_VALIDATOR_PROJECTION`.
- For behavior changes, governance gates, and bug fixes, declare `tddMode`:
  - `required` — red then green must bind the same `caseId`, `testDigest`,
    acceptance IDs, public seam, and sealed baseline/candidate lineage;
  - `recommended` — same binding contract when TDD pairs are present;
  - `reasoned-not-applicable` — requires `tddNotApplicableReason` and does not
    count as TDD success.
- Syntax, setup, environment, unrelated, digest-mismatch, and case-mismatch
  failures are not valid red. Only assertion failures on the bound case count.
- One feature card may contribute and prove multiple integration case IDs.
  Record reviewed `tddExemptions` with kind `mechanical` or `docs` when needed;
  mechanical/docs/advisory/quarantined outcomes are excluded from TDD
  success-rate inflation.
- Record red/green through `evidence run` with `--tdd-phase`, `--tdd-case-id`,
  `--tdd-test-digest`, `--tdd-acceptance`, `--tdd-public-seam`,
  `--tdd-baseline-sha`, and green `--tdd-candidate-sha`.
- Include rollback instructions. For framework tasks, prefer revertable commits
  plus any generated artifact cleanup.
- If the behavior can emit an `ATM_*` code, use `atm-error-code-resolver` in
  authoring mode before import. List each code under `errorCodes`; distinguish
  reused codes from new registrations, and include trigger, retryability,
  approval, recovery, source owner, registry owner, and focused tests.
- Do not turn normal states (`paused`, `deferred`, `inconclusive`, cache miss,
  queue position) into ErrorCodes. Codes are for stable failed or guarded
  boundaries that require operator action.
- Keep the single registry from becoming a false parallelism blocker: a plan
  with multiple implementation cards should designate one foundational card as
  registry owner, while every emitting card retains its own code contract and
  tests.
- Include `atomizationImpact` for ATM framework work:
  - name the owner atom or map;
  - list map/spec/report files that must be updated;
  - state whether new scripts are allowed.
- For any new script, require atomization ownership in the same task:
  - script path in `deliverables`;
  - owner atom/map update in `atomizationImpact`;
  - validation command in `validators`.
- Extraction-first (TASK-AAO-FABLE-006 — core ATM intent): prefer extracting
  the change as an atom or atom map over inline-editing a large module.
  - Any card whose `scopePaths` touch a module over 600 lines must declare
    `atomizationImpact.extractionCandidates`, with each candidate's
    `disposition`: `extract` (in this card), `follow-up-card`, or `inline`.
  - `extract` / `follow-up-card` is the default; `inline` requires an
    `inlineReason` recorded on the card and is a human decision — the human
    declining extraction is the only normal reason to stay inline.
  - Use the `atm-atom-map-refactor` skill to pick the owner atom and
    extraction pattern; the implementing agent must restate the proposal in
    its dispatch report when it touches a >600-line module.
  - ATM patrols this at import time: a >600-line scope without
    `extractionCandidates` receives the advisory diagnostic
    `ATM_TASK_IMPORT_EXTRACTION_FIRST_CANDIDATE` (warning-only).

## Validation Contract Lifecycle

Author cards so one validation contract drives the whole lifecycle. Evidence run,
auto-evidence, pre-close, write-readiness, and the advisory review consume the
single `evaluateValidationContract` selector — a card must never ask an adapter
to derive its own required set or recompute freshness.

- **Selected-case execution.** The contract's `requiredTestCaseIds` /
  `testContributions` are the exact cases evidence runs; declare them precisely
  so only the task-impact cases run per card and broader integration, milestone,
  plan, or release groups run at their `phaseTestCaseIds` phase owner.
- **Zero-test / fail-closed.** A required case that exits zero without executing
  its declared assertions is a zero-test failure, not a pass. A card with
  acceptance or impact edges but no resolvable required case fails closed on
  import; keep the contract resolvable rather than leaning on a full-suite run.
- **Candidate freshness.** Because a candidate change invalidates TDD, review,
  and required-case receipts, bind each required case to a stable `caseId` and
  `testDigest` so a source change under a green receipt is detected.
- **One digest, executable recovery.** The same validation-contract digest
  threads through evidence, pre-close, close, and pre-push. When the contract is
  missing or unresolvable, import surfaces the exact missing contract/case/group
  fields with one executable recovery command (`tasks import --from <plan>
  --dry-run --json`) — author the missing fields rather than waiving the gate.

## Follow-up Task Pattern

When extending an existing plan, append a follow-up section to the original plan
before creating separate cards. Avoid scattering related follow-up work across
many disconnected documents.

Each follow-up card should answer:

1. What prior decision or score exposed this work?
2. Which exact metric or gate changes?
3. Which source files, reports, maps, or policies are allowed to change?
4. Which command-backed evidence proves completion?
5. What is the rollback path?

## Team Agents Card Addendum

For Team Agents cards, add a small machine-readable Team block when the task
depends on Team runtime behavior:

```yaml
team:
  required: true
  teamLevel: L3
  roleProviders:
    implementer: openai:gpt-5-mini:responses:real-agent
    validator: anthropic:claude-3-5-sonnet:anthropic-messages:real-agent
  runtimeTier:
    reader: raw-api
    implementer: agent-sdk
    lieutenant: editor
  review:
    requiredFormalSignatures: 2
    reviewerIndependencePolicy: different-provider
  knowledge:
    permissions:
      - knowledge.query
  observability:
    requiredEventTypes:
      - artifact.output
      - broker.conflict.blocked
```

Use L1 through L5 consistently:

- L1: Coordinator, Atomization Planner, Implementer, Validator.
- L2: L1 plus Reader and Evidence Collector.
- L3: L2 plus Scope Guardian.
- L4: L3 plus Lieutenant boundary.
- L5: L4 plus Review Agent and Knowledge Scout.

Acceptance for Team cards should name the actual runtime proof, not only the
planning intent: `team start --execute` when execution is required,
`atm.teamProviderRunArtifact.v1` for provider runs,
`atm.reviewAgentSignature.v1` for review signatures, `knowledge.query` for
Knowledge Scout reads, and real observability events for runtime queries.
`broker-conflict-blocked` is a hard gate and should have a required recovery
artifact or command.

## Import Check

After authoring or editing cards, dry-run import before asking another agent to
implement them:

```bash
node atm.mjs tasks import --from "$ARGUMENTS" --dry-run --json
```

The dry-run must discover the intended task ids and must not fall back to
unrelated open tasks.

Before import, verify that `--from` points into the declared planning authority
and that import writes only the target repository's ATM-managed ledger. A local
copy of an external source card is not a valid substitute.

## Charter Invariants

- `INV-ATM-001` ??**No second registry** (enforcement: `gate`, breaking change: yes)
  Rule: A host project must not create a second AtomicRegistry implementation outside of packages/core or introduce a parallel ID allocation, version tracking, or registry promotion path.
- `INV-ATM-002` ??**Lock before edit** (enforcement: `doctor`, breaking change: no)
  Rule: No governed file mutation may occur without a valid ScopeLock recorded in .atm/locks/ for the current WorkItem. Agents must call atm lock before editing files.
- `INV-ATM-003` ??**Schema-validated promotion only** (enforcement: `gate`, breaking change: yes)
  Rule: An UpgradeProposal must pass all automatedGates (including JSON Schema validation) before promotion. Direct registry mutation that bypasses the UpgradeProposal path is forbidden.
- `INV-ATM-004` ??**No competing highest authority** (enforcement: `doctor`, breaking change: yes)
  Rule: No host project rule, profile, or configuration may declare itself to have authority equal to or higher than the AtomicCharter. Any rule that contradicts an invariant must go through a charter waiver proposal.
- `INV-ATM-005` ??**Host rule amendments require waiver flow** (enforcement: `waiver-required`, breaking change: no)
  Rule: When a host project rule conflicts with a charter invariant, the host must submit a behavior.evolve UpgradeProposal with a charterWaiver field and a linked HumanReviewDecision. Silent override is not permitted.
- `INV-ATM-006` ??**Framework work tracking stays target-local** (enforcement: `doctor`, breaking change: yes)
  Rule: The framework repository must not host downstream adopter planning queues or project-specific work tracking artifacts. ATM framework-development tasks may live in the framework repository only as ATM-managed .atm/history/tasks ledger records with CLI transition evidence.
- `INV-ATM-007` ??**Public framework docs remain English-only** (enforcement: `doctor`, breaking change: yes)
  Rule: Public contributor-facing documentation in the framework repository must remain English-only and repository-neutral. Non-English planning notes, local experiments, or downstream operating guidance must live in the coordinating host workspace unless they are translated into neutral English framework documentation.
- `INV-ATM-008` ??**Broker tickets, not refusals** (enforcement: `doctor`, breaking change: no)
  Rule: Every governed shared-write gate (runner-sync, build windows, release mirrors, git commit, projection regeneration) must respond with a broker ticket - execute now, enqueue with position, or batch into a shared write window - never a bare refusal. Reads and private writes (own ledger, evidence, task events, lane sessions) never queue. The only standing exceptions are the four owner-ruled cases in docs/governance/parallel-governance-charter.md; any new serialization point requires an explicit project-owner ruling before it ships.
- `INV-ATM-009` ??**Generalized repair and data-driven policy** (enforcement: `doctor`, breaking change: no)
  Rule: Any code logic change, bug fix, or governance rule change must first be designed as the most general rule that correctly explains the observed failure class. Hard-coded special cases are allowed only with recorded evidence that the general rule is not currently safe, feasible, or economical, and that the exception is bounded and reversible. Data-shaped behavior, including thresholds, mappings, allowlists, routing choices, telemetry classifications, prompts, message text, fixtures, and domain content, must first be modeled outside control flow through schemas, registries, configuration, observed counters, or compact digest evidence instead of embedded changeable numbers or strings. The generalized solution must remain observable, testable, and no broader than the evidence supports.
- `INV-ATM-010` ??**Single canonical worktree and compose-first shared writes** (enforcement: `doctor`, breaking change: no)
  Rule: Normal governed parallel development uses one canonical worktree, base, and HEAD. A shared physical file is compose-eligible rather than a file lock: workers declare bounded atom/CID/content-anchor/source-range intents and submit proposals, while the broker, format adapter, and transactional composer decide compose, revalidation, escalation, or queue. A neutral steward is the only shared-file writer and shared delivery records member attribution. Queueing or revalidation is a fallback for a true logical conflict, stale base/CAS failure, unsupported adapter, or fairness bound. AI workers must not use Git branches, detached worktrees, alternate indexes, merges, or rebases as normal concurrency/isolation mechanisms. The closed exceptions are emergency/anomaly recovery, historical read-only discrimination, and non-development sealed packaging; each requires a named receipt and cannot perform normal governed contribution writes.

## Guardrails

- Do not create a second task store or custom lifecycle.
- Do not hand-edit `.atm/runtime/**` or `.atm/history/**`.
- Do not use ledger-only evidence as delivery evidence for code, data, script,
  report, pipeline, or artifact tasks.
- Do not let a planning repo path enter target `allowedFiles` unless the task is
  explicitly a mirror/import task.

Do not introduce a second registry, task state, or approval path.
