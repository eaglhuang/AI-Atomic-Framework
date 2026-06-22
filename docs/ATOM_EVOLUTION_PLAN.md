# Atom Evidence-Driven Evolution

Status: Completed public design note
Date: 2026-05-18
Audience: ATM core maintainers, plugin authors, host adapter authors
Target repo: AI-Atomic-Framework

## Purpose

ATM already has the core governance surfaces needed to evolve atoms safely:

- atom lifecycle metadata;
- evidence and context summary records;
- upgrade proposal, review advisory, and human review schemas;
- behavior taxonomy and behavior guards;
- registry status transitions;
- mutability policy;
- deterministic validators.

The missing piece is not a second governance system. The missing piece is a disciplined path that turns usage evidence into reviewable, reversible, schema-valid evolution proposals for atoms and atomic maps.

This document defines the public, repository-neutral version of that path.

## Core Rule

Evidence can explain why an evolution should be considered. Evidence must not decide that the evolution is allowed.

Allowed promotion still belongs to the existing gates:

- JSON Schema validation;
- `ReviewAdvisory`;
- `HumanReviewDecision`;
- automated behavior gates;
- registry transition rules;
- mutability policy;
- rollback or retirement evidence when required.

## Design Principles

1. Do not mutate the registry directly from detectors, reviewers, or adapters.
2. Do not create a parallel proposal, review, task, registry, or promotion model.
3. Do not treat usage count alone as an evolution trigger.
4. Do not promote a host-local preference into a global atom contract by default.
5. Keep schema changes additive until a migration explicitly makes fields required.
6. Require traceable evidence or reproducible artifacts for every proposal draft.
7. Check the base atom version, base map version, and evidence watermark before promotion.
8. Route single-atom changes through `behavior.evolve`.
9. Route structural changes through `behavior.compose`, `behavior.merge`, `behavior.dedup-merge`, or `behavior.sweep`.
10. Keep public framework docs adopter-neutral and implementation-neutral.

## Evidence Model

Evidence producers may attach optional evolution signal metadata to evidence records. These fields are optional so existing evidence producers remain compatible:

- `signalKind`: the kind of observed signal;
- `signalScope`: the surface affected by the signal, such as host-local preference, repo workflow, atom, atomic map, or global contract;
- `atomId`: optional target atom ID;
- `atomMapId`: optional target atomic map ID;
- `patternTags`: tags used by deterministic detectors to group recurring patterns;
- `confidence`: detector confidence from 0 to 1;
- `recurrence`: observation window, count, first seen time, and last seen time.

These fields can support dry-run drafts and review queues, but they do not grant permission to mutate framework state.

## Upgrade Proposal Metadata

Evidence-driven upgrade proposal drafts should include optional metadata when available:

- `proposalSource`: for example `evidence-driven`, `metric-driven`, `manual`, or `spec-diff`;
- `targetSurface`: for example `host-local-overlay`, `workflow-recipe`, `atom-spec`, or `atom-map`;
- `baseAtomVersion`: required for new atom-spec proposals when the target is known;
- `baseMapVersion`: required for new atomic-map proposals when the target is known;
- `baseEvidenceWatermark`: the evidence stream position used to detect stale drafts;
- `reversibility`: for example `rollback-safe` or `breaking`;
- `evidenceGate`: required signal kinds, accepted evidence IDs, rejected evidence IDs, and gate notes.

Existing proposal fixtures do not need these fields retroactively. New evidence-driven fixtures should cover them.

## Trigger Policy

Proposal drafts should generally require both:

- sufficient usage or recurrence; and
- friction, corrective, regression, or review evidence.

The policy should be layered:

| Layer | Purpose | Output |
|---|---|---|
| L0 observation | Record explicit critique, correction, failure, or workflow rejection | Evidence candidate or finding |
| L1 ask | Ask whether the user wants a dry-run improvement draft when the finding is clear and targetable | User choice |
| L2 draft | Produce a patch draft or upgrade proposal draft when the user agrees or the issue recurs | Dry-run artifact |
| L3 queue | Apply conservative thresholds before formal promotion | Review queue item |

Early rollout should default to dry-run reports, questions, and proposal drafts. It must not directly enter the promotion path.

## Suppression Policy

The detector or host should suppress proposal generation when:

- the window contains only positive or neutral evidence;
- the signal is only a host-local formatting or workflow preference;
- detector confidence is below the configured threshold;
- the daily proposal cap for the target atom has been reached;
- the target base version changed after draft generation.

When suppression happens, the system should still emit an observation report so reviewers can understand why no proposal was generated.

## Persistence Boundary

Usage count and recurrence state must not live only in short-lived agent memory when they are used for formal queue or promotion decisions.

Acceptable persistence surfaces include:

- schema-valid evidence recurrence fields;
- governance bundle state;
- rollout reports;
- scan reports;
- registry-side telemetry;
- host adapter telemetry that is explicitly passed into the run.

ATM core should remain storage-neutral. It should emit observation reports, dry-run drafts, gate results, and schema-valid artifacts rather than binding itself to a specific database or host memory format.

## User Feedback Loop

When a user gives a clear critique, correction, or workflow rejection, the host or agent should acknowledge that the signal was recorded. The response should make the route visible:

- what was recorded;
- which target surface may be affected;
- whether a dry-run draft can be generated;
- whether the finding is suppressed, deferred, or routed to review;
- which artifact carries the evidence.

The user may choose to generate a dry-run draft, defer the issue, or suppress the pattern. Suppression should be keyed by target surface, target ID when available, finding kind, and normalized pattern tags.

High-severity or safety-relevant signals may still require review even when a matching suppression exists.

## Reviewer Bridge

The Reviewer Bridge is an advisory component. It reads evidence and context, then emits reviewable artifacts.

It may read:

- evidence lists;
- context summaries;
- atom specs;
- atomic map specs;
- registry status;
- prior proposal drafts;
- review decisions.

It may emit:

- observation reports;
- upgrade proposal drafts;
- review packets;
- stale-draft warnings.

It must not:

- mutate atom specs;
- mutate atomic maps;
- mutate the registry;
- promote proposals;
- bypass review advisory or human review;
- apply host patches directly.

## Atomic Map Evolution

Atomic map evolution is structural. It should be driven by graph and evidence signals, not text similarity alone.

Relevant signals include:

- repeated atom sequences that should become a map;
- overlapping inputs and outputs;
- duplicate or near-duplicate map members;
- downstream impact when a member atom changes;
- equivalence evidence for replacement surfaces;
- stale or orphaned map members;
- rollback and retirement proof.

Expected behavior routes:

- `behavior.compose`: promote a repeated atom sequence into an atomic map;
- `behavior.merge`: combine compatible atoms or maps when contracts align;
- `behavior.dedup-merge`: merge duplicate members while preserving lineage;
- `behavior.sweep`: detect stale, orphaned, expired, or unsafe members;
- `behavior.evolve`: propose a versioned change for one atom;
- `behavior.polymorphize`: identify template-like atom families and emit impact evidence.

Any map replacement workflow must also follow the Atomic Map Replacement Protocol in `docs/MAP_REPLACEMENT_PROTOCOL.md`.

## Safety Gates

Evidence-driven evolution must pass the same public gates as other upgrade paths:

- schema validation;
- behavior guard validation;
- review advisory validation;
- human review validation;
- status-machine validation;
- mutability-policy validation;
- rollback-proof validation when required;
- map equivalence and propagation validation when the target is an atomic map.

Recommended validation entrypoints include:

```bash
npm run validate:upgrade-proposal
npm run validate:review-advisory
npm run validate:human-review
npm run validate:behavior-pack
npm run validate:status-machine
npm run validate:map-curator
npm run validate:conversation-evolution
```

## Public Documentation Boundary

This repository should keep the public, English, contributor-facing contract:

- concepts;
- schemas;
- validators;
- CLI behavior;
- safety gates;
- public examples.

Project-specific planning notes, local task cards, and downstream governance experiments should live in their host workspaces. They may feed upstream evidence, but they should not become public framework requirements unless they have been converted into repository-neutral docs, schemas, fixtures, or validators.

## Rollout Summary

The implemented evolution work can be understood as a sequence of public surfaces:

| Area | Public responsibility |
|---|---|
| Evidence detector | Group recurring signals and emit reports |
| Evolution draft bridge | Convert qualified reports into dry-run upgrade proposal drafts |
| Conversation review bridge | Convert reviewed conversation friction into advisory findings |
| Broker split suggestion bridge | Convert blocked same-owner broker overlap into a curator-facing atom-map patch draft before any registry promotion |
| Conversation feedback loop | Preserve user choice and suppression semantics |
| Atomic map curator | Propose map-level compose, merge, dedup-merge, sweep, or impact changes |
| Example loop | Demonstrate proposal, review, approval, rejection, and rollback paths |

All of these surfaces remain advisory until existing governance gates approve promotion.

## Acceptance Criteria

This design is satisfied when:

- evidence-driven drafts are schema-valid;
- detectors do not mutate state;
- reviewers do not promote directly;
- stale base versions block promotion;
- host-local preferences do not automatically become global atom specs;
- atomic map changes carry map-level evidence;
- rollback or retirement proof is required where the target behavior demands it;
- public docs remain adopter-neutral and English.
