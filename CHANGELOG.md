# Changelog

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

## 2026-06-02

- Delivered the `taskflow.profile.v1` loader contract and de-hardcoded dry-run behavior.
- Added `actor adopt` support and restored the clean-checkout stable runner contract.
- Updated closure ledgers and fixed tracked pollution / EOF newline issues across TASK-AAO-0109~0117.

## 2026-06-01

- Recovered ATM-MAP-0003 artifacts and completed TASK-AAO-0108 recovery work.
- Completed TASK-AAO-0107 lockfile sync and related closure-state repairs.
- Improved TASK-MRP-0028 closure packet repair UX and recorded the matching ledger.

## 2026-05-31

- Finished the batch-10 leaf extraction for task-transition, git, and markdown helpers.
- Added nine unit tests and ten atom-map entries for the extraction wave.

## 2026-05-30

- Split `tasks.ts` into file-IO, parse-options, and context-map helper clusters.
- Repaired closure ledgers and rollback evidence across TASK-AAO-0081~0099.
- Synced `atm-dispatch` skills and updated dogfood / baseline governance artifacts.

## 2026-05-29

- Added `--summary` and `--fields` output projection support for `next` and `tasks`.
- Extracted route predicates, view projections, intent normalizers, and match/sort helpers from `next.ts`.
- Hardened prompt-scoped routing, claim-lock consistency, and frontmatter diagnostics.

## 2026-05-28

- Added closure-packet attestation support and delivery evidence gates.
- Delivered `tasks reconcile` and `deliver-and-close` macro flows for historical-done tasks.
- Imported target ledgers and updated CLI usage envelopes and evidence reporting.

## 2026-05-27

- Expanded batch playbook states and checkpoint flows, including queue-preview / queue-head-active / repair-required.
- Added evidence-missing, validator-list, and mirror-sync helpers for task routing and closure sync.
- Synchronized skills, prompts, and governance artifacts across the framework.

## 2026-05-26

- Added actor sessions and a governed commit wrapper for git identity handling.
- Improved taskflow, team planning, and CLI diagnostics, including checkpoint and runtime recommendation helpers.
- Completed the atomization-wave tooling and coverage reports across core, CLI, and seed governance.

## 2026-05-25

- Tightened `next` task discovery and prompt-scoped routing.
- Rewrote the `atomize` inventory / score commands and added git-head evidence backfill.
- Hardened batch checkpoints, task closure, and root-drop / onefile release validation.

## 2026-05-24

- Hardened task-claim lifecycle, closure evidence, and push-guard handling.
- Added legacy baseline cut logic and cross-repo / adopter sync protections.
- Clarified keep-file guidance and target-repo contract behavior in docs and tests.

## 2026-05-23

- Introduced prompt-scoped `next` routing and the semantic task-intent contract.
- Added self-atomization task routing and prompt / skill updates for task selection.
- Stabilized CLI version validation and target-task authority enforcement.

## 2026-05-22

- Added framework-development hard gates and cross-repo drift protections.
- Added adopter sync release gates and allowed governed runner sync commits.
- Preserved host Copilot instructions and cleaned git-head evidence / task-lock handling.

## 2026-05-21

- Added the framework integration hook contract and task ledger governance.
- Added atomization coverage, backfill, and inventory tooling.
- Added internal release sync workflows and task/card validation gates.

## 2026-05-20

- Added root `node atm.mjs --version` support.
- Emitted a deterministic JSON result envelope for version output.
- Added CLI validation coverage and aligned the README quick reference with release artifacts.

## 2026-05-17

- Closed replacement evidence gating for M10: added `atm.propagationReport` and `atm.retirementProof`, required propagation/review/human approval before `canary -> active`, and allowed `legacy-retired` promotion through rollback proof or caller/entrypoint-cleared retirement proof.
- Added ScopeLock 0.2.0 map selectors and polymorph impact gating: `scope-lock` now round-trips `0.1.0` and `0.2.0`, `upgrade --propose --replacement-mode active` can require `--polymorph-impact-report`, and active map proposals now validate impacted instance maps for template-bound members.
- Hardened spec-based and plan-based map provisioning: `create-map --spec <path>` validates `atm.atomicMap` JSON Schema and preserves `0.2.0` replacement metadata, while `create-map --from-plan <path>` adds decomposition-plan provisioning and spec round-trip coverage.
- Added replacement-lane transition validation and map upgrade evidence gates: explicit `draft -> shadow -> canary -> active -> legacy-retired` checks, `upgrade --propose --target map` support for `--replacement-mode`, `--equivalence-report`, and `--rollback-proof`, plus blocks for active and legacy-retired proposals without the required evidence.
- Delivered M4-M10 integration rollout and adapter hardening: framework-neutral onboarding proof, agent entry skill templates, integration lifecycle CLI, map equivalence coverage, and the M5/M4 adapter contract suite for Claude Code, Copilot, Cursor, and Gemini.

## 2026-05-12

- Delivered ATM v0.2 phase-3 portable onefile pipeline.
- Removed remaining `@ts-nocheck` debt across core governance flows.
- Converged npm-first tooling and governance entrypoints.

## 2026-05-11

- Added adopter-local workbench localization migration guidance.
- Removed adopter-derived artifacts from protected upstream surfaces.
- Added polymorphic template and dimension contracts (ATM-2-0032).
- Added non-blocking review advisory provider flow (ATM-2-0035).
- Delivered case-study pilots ATM-4-0004 and ATM-4-0008.
- Implemented map evolution routing (ATM-2-0024).

## 2026-05-10

- Added inject rollback dry-run plans in case-study fixtures.

## 2026-05-09

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
