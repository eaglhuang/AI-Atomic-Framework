# Changelog

## [Unreleased] - 2026-06-28

Post-paper mainline changes landed after `v0.9.0-alpha.1`.

This section records adopter-visible behavior, release-surface fixes,
new benchmark/evidence tracks, and the first shipped ATM skill growth
bridge after the paper-aligned public release.

### Added - skill/tool bridge and benchmark tracks

- **Tool bridge result contract v1** plus follow-up operator bridge
  fields for structured CLI-to-skill handoff (`feat(cli): add tool
  bridge result contract v1`, TASK-SKL-0003 / 0004 follow-up delivery).
- **SKL runtime pilot and growth observability** with tool-first
  mirrors, schema artifacts, and frozen-runner lesson linking
  (`47bc59982`, `772331930`, `7599e5580`).
- **ATM AdmissionBench refresh** with rebuilt v0.2 source chain and
  published v0.1 / v0.2 evidence bundles (`2088a791c`, `9a0c03e59`,
  `ab8753b7d`).
- **ATM OperationalBench** public overhead benchmark and supplementary
  evidence publication (`85f2b2f92`, `5294c1bf9`, `f117997c9`).
- **Structured artifact admission evidence track** plus fast-path
  verification and containment evidence (`014ab0fb3`, `7a88af7d3`).

### Changed - release and governance hardening

- **Framework claim preflight in CI and release lanes** so required
  framework governance gates fail earlier and more clearly
  (`ee59316fc`).
- **Sandbox self-hosting template tracking** for the Claude Code agent
  pack (`a7928f4ad`).
- **Paper quick-verify instructions** added to the public docs
  (`a823febb4`).

### Fixed - CLI, hook, evidence, and release behavior

- **Completion report detector narrowing** so ordinary governance
  backlog prose stops being treated like closeout evidence
  (`efdb2373f`, `ae654da87`).
- **Repo-local broker evidence path defaults** parameterized and
  guarded by regression coverage (`28d474ee1`, `545c50aa5`).
- **CLI onboarding validation fixture isolation** so `validate:cli`
  no longer depends on polluted onboarding state (`abf028541`).
- **Repo-selection environment sanitization** across wrapper and hook
  lanes (`cd32407a9`).
- **Actor identity and skill integration hardening** including
  explicit governed actor enforcement, `identity clear`, per-actor
  identity resolution, editor/provider mismatch checks, non-critical
  git-head scope narrowing, pre-push worktree-local git-head evidence
  visibility, shared validator fixture contracts, and validator
  duration budget reporting (`c589f1250`, with commit-level
  git-head backfill in `f57dbfe0b`).

### Daily log

#### 2026-06-28

- Added paper quick-verify docs and isolated `validate:cli` onboarding
  fixture resolution.
- Sanitized repo-selection environment handling across ATM wrapper and
  hook paths.
- Merged the paper evidence fast path into `main`.
- Shipped the identity / hook / validator / skill-template repair lane:
  explicit actor governance, `identity clear`, per-actor identity
  lookup, editor mismatch checks, pre-push worktree-local git-head
  evidence visibility, non-critical git-head scope narrowing, shared
  validator fixture contracts, and validator duration budget reporting.
- Published fast-path verification and containment evidence and synced
  backlog / handoff governance records for the repair lane.

#### 2026-06-27

- Added ATM OperationalBench public benchmark plus supplementary
  evidence bundles.
- Parameterized repo-local broker evidence path defaults and added
  regression coverage.
- Narrowed completion-report markdown detection to reduce false
  governance blocks.
- Integrated the SKL team-growth line into the framework main route.
- Added structured artifact admission evidence and synchronized the
  release-side completion detector narrowing.

#### 2026-06-25

- Added CI framework-claim preflight for required release gates.
- Built and published ATM AdmissionBench v0.1 / v0.2 source and
  evidence chains.
- Fixed auto-matrix workflow YAML quoting and refreshed git-head
  evidence around the release rerun lane.
- Tracked Claude Code sandbox self-host templates for self-hosted
  agent-pack installs.

#### 2026-06-24

- Completed the SKL tool-first bridge fields and runtime pilot.
- Recorded SKL governance artifacts, closure evidence, and mirrored
  runtime/schema outputs.
- Linked the frozen-runner build lesson back into SKL runtime evidence
  so the skill-growth layer captures the dogfood path.

## [0.9.0] — 2026-06-23 (paper-aligned first public release)

First public release accompanying the arXiv preprint
*"ATM: Adapter-Guided Atomization with CID Broker for Single-Domain
Multi-Vendor LLM Code Co-Synthesis"* (preprint pending; this release is
the paper-aligned snapshot of all ✅ claims).

Scope of this release: single-workspace / single-filesystem-domain
pre-write admission control for multi-agent LLM code synthesis.
Cross-machine / cross-clone Git PR resolution is explicitly out of
scope and remains delegated to Git's three-way merge and human review.

### Added — admission core

- **Two-tier Contract Identifier (CID)** — candidate CID (metadata
  fingerprint) and capsule CID (content-addressed) for cross-process
  atom identity (`packages/core/src/registry/`, `packages/core/src/broker/candidate-bridge.ts`).
- **Seven-layer hard gate** — CID identity → shared surface →
  read/write set → file range / AGR → ConflictKey + canMerge →
  CAS base-hash → fallback file lock
  (`packages/core/src/broker/decision.ts`,
  `conflict-matrix.ts`, `policy.ts`).
- **Augmented Decision Rule** — read/write-set intersection check at
  admission time (TASK-CID-0032).
- **CAS base-hash guarded apply** — bounded one-shot re-plan on hash
  mismatch (`packages/core/src/broker/cas.ts`, Definition 6 in paper).
- **Neutral steward arbitration flow** — four-verdict (apply /
  merge-required / blocked / human-required) fail-closed gate
  (TASK-MAO-0009, `packages/core/src/broker/steward.ts`).

### Added — Adaptive Granularity Refinement (AGR)

- **AGR Layer 1: Syntactic Enclosure Atomization** — purely structural
  refinement, no LLM call
  (`packages/core/src/broker/agr.ts`, TASK-CID-0029).
- **AGR Layer 2: Signature-Preserving Decomposition** — θ_count /
  θ_density threshold-bounded decomposition for hunk-level conflicts
  (`packages/core/src/broker/policy.ts`, TASK-CID-0031).
- **Symbol Canonicalization Policy** — per-adapter deterministic
  `canon_sym` mapping for stable CID across renames / namespaces
  (TASK-CID-0033).
- **Adapter Planning SDK** — `discoverAtomCandidates`,
  `EnclosingUnit`, `VirtualAtom` contracts
  (`packages/plugin-sdk/src/atomization-planning.ts`,
  TASK-ASP-0001 ~ 0005).

### Added — Format-agnostic generalization

- **Format adapter subsystem** — file-mutation adapter registry plus
  five shipped adapters: `json-record`, `text-range`,
  `numeric-scalar` (commutative-merge), `atom-map` (domain),
  `fallback-file-lock`
  (`packages/core/src/broker/adapters/`,
  TASK-CID-0091 ~ TASK-CID-0098).
- **Batch planner and content-addressed CAS** —
  `batch-planner.ts`, `cas.ts`.
- **ConflictKey taxonomy** — `(scope, locator)` pair across `file` /
  `record` / `range` / `line` / `scalar` / `semantic` scopes
  (Theorem 3 in paper).

### Added — Multi-Agent Orchestration (MAO) and Team Agents Wave Mode

- **MAO Route Context state machine** — `open → admitted → frozen →
  waiting → blocked → ready-to-apply → closed/abandoned`
  (TASK-MAO-0001 ~ 0003).
- **Freeze / patch-envelope / conflict-matrix snapshot protocol** —
  crash-safe arbitration with WIP capture
  (`packages/core/src/broker/freeze.ts`, `patch-envelope.ts`,
  `conflict-matrix.ts`, TASK-CID-0040 / 0041).
- **MAO parallel routing benchmark** — 12 scenarios, full hazard-catch coverage
  (8/8 unsafe), 0 false-safe, 0 expectation failures
  (TASK-MAO-0010, `docs/reports/mao-parallel-routing-benchmark.md`).
- **Team Agents Wave Mode** — batch admission for related task cards
  with coordinator-only lifecycle authority
  (TASK-MAO-0023 ~ 0034); 5/5 dogfood scenarios passing
  (`docs/reports/team-wave-mode-dogfood.md`).
- **External / runner-broker pipelines** — runner submit-patch,
  runner-ref publish, broker bootstrap recovery, external core
  contributor pipeline (TASK-MAO-0014 ~ 0022).

### Added — Git Boundary Admission Bridge (Topology C)

- **`atm git admit` CLI** — pre-push admission entry point reusing
  the broker / format-adapter / composer / steward pipeline
  (TASK-GIT-0001 ~ TASK-GIT-0012 delivered across the 2026-06-23 release wave).
- **Pre-push Git hook** — invokes `atm git admit` against
  `git merge-base HEAD origin/<branch>`, builds local and remote
  mutation requests, and either allows the push, blocks with
  reviewable evidence, or routes through deterministic composer.
- **Push-fail fallback** — same admission path runnable post-fail.
- **Steward dry-run / apply** — write-back to working tree without
  auto-commit by default.
- **Paper-ready evidence harness** — git-boundary fixture coverage
  feeding paper §6.4.3 / Appendix A.4.
- Out of scope for MVP: per-commit gate, background daemon, cross-
  machine broker RPC, full auto-rebase engine, auto-commit-on-apply,
  cross-machine PR race resolution.

### Added — Refinement loop (🔶 dogfood-backed prototype)

- Structured **split suggestion** generated on
  `blocked-cid-conflict`, promoted to **curator patch draft**, and
  queued for **human-reviewable approval** with approve-decision
  trace.
- Same-owner bounded atom dogfood case as backing evidence
  (TASK-TEAM-BROKER-HOT-FIRST / -DISJOINT,
  `docs/reports/same-owner-bounded-atom-dogfood/`).

### Added — Field evidence and adoption

- **POS2 cross-vendor same-file end-to-end merge** —
  `codex-gpt54mini` vs `claude-opus47` on
  `packages/cli/src/commands/broker.ts`,
  bounded regions `841-878` and `989-1142`, baseCommit
  `51dd72a70c835cad57786607fe7ad733655286d0`,
  merge plan `merge-255c73707a528edc`, steward verdict `applied`,
  validator pass.
- **close-orchestration field outcome** — live multi-vendor
  same-file different-function admission case.
- **B-12 controlled field collision** — cross-vendor late-enforcement
  case (admission `parallel-safe`, apply-phase fail-closed at
  active-intent contention).
- **npc-brain three-week adoption study** — 37 atomization task
  cards, 0 unrecovered admission errors, honest narrative of one
  10-card scope-lock contention burst with ledger-replay recovery.
- **Self-hosting forensics** — TASK-CID-0040 ~ TASK-CID-0045
  incident series and reconciliation packets feeding paper §4.2.

### Added — Validation harnesses

- **12-scenario AGR fixture suite** (`scripts/validate-agr-benchmark.ts`,
  TASK-CID-0037).
- **5-scenario format-adapter dogfood** with `SHIP` recommendation
  (`packages/core/src/broker/__tests__/dogfood-adapter-benchmark.test.ts`).
- **Team Wave Mode dogfood**
  (`scripts/validate-team-wave-mode.ts`, 5/5 scenarios).
- **MAO parallel routing benchmark**
  (`scripts/validate-mao-parallel-routing.ts`,
  12 scenarios, full hazard-catch coverage).
- **CID stability validator**
  (`scripts/validate-atom-id-to-cid.ts`).

### Known limitations (carried forward into v1.0 backlog)

- Cross-language atom identity (across regimes) remains an open
  problem (paper §3.9).
- CID schema migration paths (flag-day vs dual-read vs compatibility
  map) deliberated but not finalized (paper Appendix A.3).
- Comparative throughput benchmarks against STORM / CodeCRDT / SCF
  are deferred to the December 2026 full paper (paper §5).
- Topology B (shared-server multi-vendor deployment) and Topology D
  (distributed broker over network) are documented as deployment
  vision but not engineered in this release (paper §6.4.2 / §6.4.5).

### Reproducibility

Reviewers can map every ✅ claim in the accompanying paper to source
location and verification command via paper Appendix A.4. The
companion evidence repository at
`https://github.com/eaglhuang/3KLife` (`docs/ai_atomic_framework/`)
holds frozen artifact snapshots tagged `v0.9.0-paper`.

### Daily log

#### 2026-06-23

- Locked Git Boundary Admission contract and delivered TASK-GIT-0002~0012: admission CLI, pre-push hook scaffolding, push-fail fallback, steward dry-run/apply, paper-ready evidence harness.
- Archived TASK-PAPER-HOTFILE-BLOCK-A/B ledgers, closed governance + release sync, wired shared skill growth contracts.

#### 2026-06-22

- Delivered TASK-CID-0117~0119 live apply evidence and adoption gate, plus TASK-PAPER-HOTFILE-POS2-A cross-vendor merge.
- Added structured split suggestions, curator bridge to patch drafts, reviewer queue, and same-owner bounded merge outcome.
- Packaged same-owner bounded atom paper evidence bundle and preserved proposal admission + rearbitration evidence.

#### 2026-06-21

- Delivered TASK-CID-0115 proposal admission runtime, TASK-CID-0116 closeout, pre-patch merge candidate scanner.
- Captured team-run brokerLane evidence and synced proposal admission schemas + validator.

#### 2026-06-20

- Completed TASK-AAO-0145 governance, residue auto-clean for git-governance / runtime / scoped commit lanes.
- Closed TASK-AAO-0078 / 0103 / 0109 / 0115 / 0042 / 0043 / 0044 (with stage-only completion variant), TASK-RFT-0009, TASK-AAO-0146 runner arbitration + claim intent fix.
- Added broker evidence capture / collection tooling for paper plan, chinese mojibake cleaner training workflow, TASK-TEAM-0037~0041 emergency vendor runtime bundle.

#### 2026-06-19

- Delivered TASK-TEAM-0018 lease fencing diagnostics and TASK-TEAM-0019 / 0031~0036: runtime mode adapter, editor subagent bridge, rework route state machine, artifact handoff retry, nodejs worker adapter, sandbox attestation closure, polyglot worker examples.
- Added broker transactions schema, serialized commit lane, steward apply evidence, patrol broker gates, broker subagent contract + governance.
- Closed TASK-AAO-0110 / 0112 / 0113 / 0122 / 0123 / 0126 / 0127 / 0129 / 0135 / 0136 / 0137, TASK-CID-0113 / 0114, stale lease epoch close gate fix.

#### 2026-06-18

- Delivered the runner-broker pipeline series: TASK-MAO-0014 runner-ref publish, TASK-MAO-0016 submit-patch, TASK-MAO-0017 version stream, TASK-MAO-0018 closure packet binding, TASK-MAO-0019 cross-repo dual-binding, TASK-MAO-0020 broker bootstrap recovery, TASK-MAO-0021 failure-mode coverage, TASK-MAO-0022 external core contributor pipeline.
- Delivered TASK-MAO-0043~0048 / 0053~0058 (repair-claim, knowledge boundary, closeback runbook, knowledge cache fencing, build query dry-run, preflight summaries, retention budget, opt-in rerank, patrol report).
- Delivered TASK-AAO-0142 auto-run declared validators, TASK-AAO-0143 close absorbs regenerable artifacts, TASK-AAO-0144 governed git entrypoint + build output hygiene.
- Closed TASK-CID-0091~0097 format adapter governance bundle.

#### 2026-06-17

- Delivered the full **Team Agents Wave Mode v1** series TASK-MAO-0023~0034: architecture contract, candidate planner + `team wave` CLI, Wave Envelope schema, broker admission, runtime record + dispatch + validator, worker report contract, per-task evidence slicing, partial-completion checkpoint, coordinator-only closeout guard, validator/reviewer roles, dogfood benchmark, operator guide.
- Delivered TASK-MAO-0036 / 0038 / 0049 (closeback orchestration route correctness, repair-closure guards, scope add audit lane), TASK-MAO-0039~0042 / 0050~0052.
- Delivered TASK-MAO-0015 patch envelope ATM core specialization; fixed import scanner lookalike handling.

#### 2026-06-16

- Delivered **format-adapter subsystem**: mutation adapter registry plus JSON / text / numeric format adapters and the atom-map domain adapter (TASK-CID-0091~0098).
- Delivered batch planner + content-addressed CAS, dogfood gate, atomization receipts, historical batch envelope MVP.
- Delivered TASK-MAO-0009 steward arbitration flow, TASK-MAO-0010 parallel routing benchmark (12 scenarios, full hazard-catch coverage), TASK-MAO-0004 next route + task selector with fresh evidence, TASK-MAO-0007 / 0008 / 0035 closebacks, TASK-CID-0099~0111 governance bundles, broker neutrality fix (adopter path to config).

---

## [0.8.0] — 2026-06-15 (AGR + MAO Route Context + Team Agents v1)

Bridge release between brokered-write foundation (v0.7.0) and the
paper-aligned format-adapter wave (v0.9.0). Introduces AGR layer 1/2,
freeze + patch envelope snapshot protocol, MAO Route Context state
machine + lifecycle CLI, conflict-set matrix arbitration, runner
reproducible-build gate, and the first Team Agents template /
patrol / planner contracts.

### 2026-06-15

- Delivered TASK-TEAM-0015~0016 task recommendation surface and team start delivery, plus TASK-TEAM-0029 team-start claim gate parity.
- Added the repo-aware bug backlog router skill and team lease target-path normalization.
- Reconciled TASK-MAO-0005~0006 closebacks and the TASK-AAO-0118 import/release cycle.

### 2026-06-14

- Delivered MAO logical routing foundation: TASK-MAO-0001 logical routing contract, TASK-MAO-0002 route context contract, TASK-MAO-0003 route lifecycle CLI.
- Delivered runner build hardening: TASK-MAO-0011 reproducible build gate, TASK-MAO-0012 build scope manifest, TASK-MAO-0013 atm core scope classifier.
- Delivered TEAM-0004~0006 templates and patrol surfaces, plus TASK-RFT-0003 framework-development facade extraction and TASK-RFT-0008 commit message strategy map.
- Delivered TASK-TEAM-0009~0013 plan resolver, role selector, start status runtime, permission lease validator, file write scope validator.
- Closed TASK-CID-0077~0090 closeout governance bundle and TASK-CID-0089 doctor integration drift remediation.

### 2026-06-13

- Hardened dual-repo close bundle and added the planning-authority closeback delivery path.
- Added TASK-CID-0065 emergency backend approval lane, TASK-CID-0066 new user workflow guide, and the `atm-atom-map-refactor` skill.
- Closed TASK-CID-0043~0076 governance bundles, extracted closeout provenance atom and dependency gate atom, normalized `writeReadinessHint` operator/backend guidance (TASK-CID-0073).

### 2026-06-12

- Delivered AGR core: TASK-CID-0033 adapter AGR contracts, TASK-CID-0035 AGR steward runtime, TASK-CID-0037 12-scenario AGR benchmark harness.
- Delivered TASK-CID-0040 freeze + patch envelope snapshot protocol, TASK-CID-0041 conflict-set matrix arbitration, TASK-CID-0044 recovery + orphan cleanup, TASK-CID-0045 AGR conflict benchmark harness.
- Added broker `route` command for steward takeover and validator-gated apply.
- Delivered TASK-CID-0050 tasks atomic map + invariant inventory, TASK-CID-0061 stabilized public surface contract, TASK-CID-0064 closure packet recovery.

### 2026-06-11

- Added broker-owned write actor boundary and closeout-only claim intent CLI aliases.
- Delivered TASK-AAO-0139 task-id casing governance, TASK-AAO-0140 closeback orchestration, TASK-AAO-0141 delivery.
- Delivered TASK-CID-0032 read-set broker decision contract, TASK-CID-0034 AGR runtime registry, TASK-CID-0036 AGR closeout validator.
- Refined atom CID semantics and validation; fixed CLI lazy-load to break import cycles and prevented pre-tool stdin hang.

### 2026-06-10

- Delivered AGR atomization-planning SDK series: TASK-ASP-0001 AtomizationPlanningAdapter contract, TASK-ASP-0002 scanner-based atom candidate discovery, TASK-ASP-0003 python adapter promotion, TASK-ASP-0004 candidate-to-WriteIntent bridge with deterministic atomCid, TASK-ASP-0005 closeout.
- Delivered TASK-AAO-0138 formal opener and residue finalization UX, TASK-APO-0030 python language adapter plugin.
- Honored close commit window for closure packets, relaxed claim blockers, auto-imported taskflow cards.

---

## [0.7.0] — 2026-06-09 (Brokered-write foundation + neutral steward)

First brokered-write lifecycle release: TASK-CID-0017~0024 broker
proposal runtime, neutral write steward, parallel advisor + validator
paths, captain ergonomics, and write-path atomicity. Foundational
work that the AGR layers (v0.8.0) and format adapters (v0.9.0) build
on.

### 2026-06-09

- Added protected-branch and current-head git-head evidence backfills, plus frozen runner artifact sync.
- Delivered TASK-AAO-0135~0137 brokered-write and captain ergonomics work, including acceptance harnesses and write-path atomicity.
- Continued TASK-CID-0020~0023 ledger persistence and evidence refresh work across brokered-write, team, and historical-close flows.

## 2026-06-08

- Completed TASK-CID-0019~0022 broker lifecycle work, including neutral write steward, team brokered-write, and lifecycle integration lanes.
- Reconciled CID ledgers, backfilled git-head evidence, and stabilized dirty-state handling for the brokered flows.
- Fixed runner entrypoint validation and removed mailbox script `ts-nocheck` debt to keep doctor and root-drop checks unblocked.

## 2026-06-07

- Added broker proposal runtime support and hardened the parallel advisor and validator paths.
- Closed TASK-CID-0017 and TASK-CID-0018 with refreshed evidence, closure metadata, and handoff capture.
- Synced release-manifest and onefile outputs for TASK-AAO-0134 while preserving the claim lifecycle artifacts.

## 2026-06-06

- Restored TASK-AAO-0063 ledger artifacts and added the historical ledger restore task card.
- Cut the framework import commit-range baseline and updated git-head / ignore rules.
- Imported the ATM framework source and release bundle while cleaning local scratch and static evidence.

## 2026-06-05

- Recovered TASK-TEAM-0002 / TASK-TEAM-0003 closure ledgers and related governance artifacts.
- Rebuilt bootstrap and git-head evidence history around the import path.
- Added taskflow dry-run reporting and completed the release-ledger backfill work.

## 2026-06-04

- Hardened TASK-AAO-0122~0128 closure packets, runner sync, and repair-context guards.
- Added the captain dispatch entry gate and enforced ATM terminology / dispatch protocol.
- Normalized task-scope path comparisons and refreshed release/license governance, including the `origin/main` merge.

## 2026-06-03

- Implemented section-aware task-card scope extraction and `outOfScope` subtraction.
- Aligned the frozen runner and release onefile for TASK-AAO-0119~0121.
- Mirrored TEAM ledger entries and repaired closure packets for TASK-AAO-0114 and TASK-AAO-0120.

---

## [0.6.0] — 2026-06-02 (Profile loader + output projections)

Adds `taskflow.profile.v1` loader contract, `actor adopt` lifecycle,
clean-checkout stable runner contract, and `--summary` / `--fields`
output projection across `next` and `tasks`. Also restores
ATM-MAP-0003 governance and completes TASK-AAO-0107~0117 batch.

### 2026-06-02

- Delivered the `taskflow.profile.v1` loader contract and de-hardcoded dry-run behavior.
- Added `actor adopt` support and restored the clean-checkout stable runner contract.
- Updated closure ledgers and fixed tracked pollution / EOF newline issues across TASK-AAO-0109~0117.

### 2026-06-01

- Recovered ATM-MAP-0003 artifacts and completed TASK-AAO-0108 recovery work.
- Completed TASK-AAO-0107 lockfile sync and related closure-state repairs.
- Improved TASK-MRP-0028 closure packet repair UX and recorded the matching ledger.

### 2026-05-31

- Finished the batch-10 leaf extraction for task-transition, git, and markdown helpers.
- Added nine unit tests and ten atom-map entries for the extraction wave.

### 2026-05-30

- Split `tasks.ts` into file-IO, parse-options, and context-map helper clusters.
- Repaired closure ledgers and rollback evidence across TASK-AAO-0081~0099.
- Synced `atm-dispatch` skills and updated dogfood / baseline governance artifacts.

### 2026-05-29

- Added `--summary` and `--fields` output projection support for `next` and `tasks`.
- Extracted route predicates, view projections, intent normalizers, and match/sort helpers from `next.ts`.
- Hardened prompt-scoped routing, claim-lock consistency, and frontmatter diagnostics.

---

## [0.5.0] — 2026-05-28 (Task lifecycle hardening + governed commit)

Adds closure-packet attestation, `tasks reconcile` and
`deliver-and-close` macro flows for historical-done tasks, governed
commit wrapper for git identity handling, batch-playbook checkpoint
states, and the atomization-wave tooling / coverage reports across
core, CLI, and seed governance.

### 2026-05-28

- Added closure-packet attestation support and delivery evidence gates.
- Delivered `tasks reconcile` and `deliver-and-close` macro flows for historical-done tasks.
- Imported target ledgers and updated CLI usage envelopes and evidence reporting.

### 2026-05-27

- Expanded batch playbook states and checkpoint flows, including queue-preview / queue-head-active / repair-required.
- Added evidence-missing, validator-list, and mirror-sync helpers for task routing and closure sync.
- Synchronized skills, prompts, and governance artifacts across the framework.

### 2026-05-26

- Added actor sessions and a governed commit wrapper for git identity handling.
- Improved taskflow, team planning, and CLI diagnostics, including checkpoint and runtime recommendation helpers.
- Completed the atomization-wave tooling and coverage reports across core, CLI, and seed governance.

### 2026-05-25

- Tightened `next` task discovery and prompt-scoped routing.
- Rewrote the `atomize` inventory / score commands and added git-head evidence backfill.
- Hardened batch checkpoints, task closure, and root-drop / onefile release validation.

### 2026-05-24

- Hardened task-claim lifecycle, closure evidence, and push-guard handling.
- Added legacy baseline cut logic and cross-repo / adopter sync protections.
- Clarified keep-file guidance and target-repo contract behavior in docs and tests.

---

## [0.4.0] — 2026-05-23 (CLI + intent routing)

Introduces prompt-scoped `next` routing, the semantic task-intent
contract, framework-development hard gates, cross-repo drift
protections, adopter sync release gates, root `node atm.mjs
--version` support, and deterministic JSON result envelope for
version output.

### 2026-05-23

- Introduced prompt-scoped `next` routing and the semantic task-intent contract.
- Added self-atomization task routing and prompt / skill updates for task selection.
- Stabilized CLI version validation and target-task authority enforcement.

### 2026-05-22

- Added framework-development hard gates and cross-repo drift protections.
- Added adopter sync release gates and allowed governed runner sync commits.
- Preserved host Copilot instructions and cleaned git-head evidence / task-lock handling.

### 2026-05-21

- Added the framework integration hook contract and task ledger governance.
- Added atomization coverage, backfill, and inventory tooling.
- Added internal release sync workflows and task/card validation gates.

### 2026-05-20

- Added root `node atm.mjs --version` support.
- Emitted a deterministic JSON result envelope for version output.
- Added CLI validation coverage and aligned the README quick reference with release artifacts.

---

## [0.3.0] — 2026-05-17 (M4–M10 integration + ScopeLock 0.2.0 + replacement gating)

Single-day major release that closed M4–M10 rollout and adapter
hardening, delivered ScopeLock 0.2.0 map selectors with polymorph
impact gating, spec-based / plan-based map provisioning, and the
replacement-lane transition validation chain
(`draft → shadow → canary → active → legacy-retired`) with required
propagation / review / human-approval / rollback proof evidence.

### 2026-05-17

- Closed replacement evidence gating for M10: added `atm.propagationReport` and `atm.retirementProof`, required propagation/review/human approval before `canary -> active`, and allowed `legacy-retired` promotion through rollback proof or caller/entrypoint-cleared retirement proof.
- Added ScopeLock 0.2.0 map selectors and polymorph impact gating: `scope-lock` now round-trips `0.1.0` and `0.2.0`, `upgrade --propose --replacement-mode active` can require `--polymorph-impact-report`, and active map proposals now validate impacted instance maps for template-bound members.
- Hardened spec-based and plan-based map provisioning: `create-map --spec <path>` validates `atm.atomicMap` JSON Schema and preserves `0.2.0` replacement metadata, while `create-map --from-plan <path>` adds decomposition-plan provisioning and spec round-trip coverage.
- Added replacement-lane transition validation and map upgrade evidence gates: explicit `draft -> shadow -> canary -> active -> legacy-retired` checks, `upgrade --propose --target map` support for `--replacement-mode`, `--equivalence-report`, and `--rollback-proof`, plus blocks for active and legacy-retired proposals without the required evidence.
- Delivered M4-M10 integration rollout and adapter hardening: framework-neutral onboarding proof, agent entry skill templates, integration lifecycle CLI, map equivalence coverage, and the M5/M4 adapter contract suite for Claude Code, Copilot, Cursor, and Gemini.

---

## [0.2.0] — 2026-05-12 (Portable runner + npm-first + polymorph contracts)

Delivered ATM v0.2 phase-3 portable onefile pipeline, removed
remaining `@ts-nocheck` debt across core governance flows, converged
npm-first tooling and governance entrypoints, added polymorphic
template and dimension contracts (ATM-2-0032), the non-blocking
review advisory provider flow (ATM-2-0035), case-study pilots
ATM-4-0004 / ATM-4-0008, and map evolution routing (ATM-2-0024).

### 2026-05-12

- Delivered ATM v0.2 phase-3 portable onefile pipeline.
- Removed remaining `@ts-nocheck` debt across core governance flows.
- Converged npm-first tooling and governance entrypoints.

### 2026-05-11

- Added adopter-local workbench localization migration guidance.
- Removed adopter-derived artifacts from protected upstream surfaces.
- Added polymorphic template and dimension contracts (ATM-2-0032).
- Added non-blocking review advisory provider flow (ATM-2-0035).
- Delivered case-study pilots ATM-4-0004 and ATM-4-0008.
- Implemented map evolution routing (ATM-2-0024).

### 2026-05-10

- Added inject rollback dry-run plans in case-study fixtures.

---

## [0.1.0] — 2026-05-09 (Seed governance + AtomBehavior Plugin SDK)

First governed release of the ATM seed: committed self-description
and self-verification (Phase B1), atom/map status state machine with
governance tiers (ATM-2-0027), AtomBehavior Plugin SDK with evolve
delegation guard (ATM-2-0028), atomic map provenance family
(ATM-2-0043 ~ 0046), semantic fingerprint extension (ATM-2-0026),
review gate command flow (ATM-2-0021), registry version-history
scaffolding, and the lifecycle police plugin (ATM-2-0031).

### 2026-05-09

- Added legacy dry-run adapter contract.
- Implemented lifecycle police plugin (ATM-2-0031).
- Completed consolidated behavior pack delivery (ATM-2-0029).
- Backfilled missing semantic fingerprints.
- Completed atomic map provenance family ATM-2-0043 to ATM-2-0046.
- Implemented AtomBehavior Plugin SDK with evolve delegation guard (ATM-2-0028).
- Implemented atom/map status state machine with governance tiers (ATM-2-0027).

## 2026-05-08

- Refreshed generator provenance evidence.
- Added semantic fingerprint extension (ATM-2-0026).
- Finalized review gate command flow (ATM-2-0021).

## 2026-05-07

- Added registry version-history scaffolding.
- Added `currentVersion` and `versions[]` history fields.
- Added an in-memory upcast helper plus legacy/versioned fixtures.

## 2026-05-06

- Phase B1 complete: committed self-description and self-verification landed for the seed.
- Phase B1 complete: the registry status is now governed.
- Legacy planning ID ATM-CORE-0001 remains as metadata, while ATM-CORE-0002 governs the retained hand-written seed source.
