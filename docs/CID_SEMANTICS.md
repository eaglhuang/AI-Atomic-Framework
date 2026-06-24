# CID Semantics

This document is the canonical CID semantics reference for `TASK-CID-0002`.

It covers `semanticFingerprint` / `CID.Interface` only. For broker admission `Candidate CID`, capsule export/import `Capsule CID`, and the synthetic broker `atomCid` used by `team-lane.ts`, see `docs/BROKER_GUIDE.md` and `packages/core/src/registry/atom-capsule.ts`.

## Core rule

`semanticFingerprint` is a deterministic, normalized **contract/interface + execution-constraint fingerprint**.

It is not an AST identity, not an embedding, and not a proxy for hidden semantic intent.

## Axioms

### A1. Identity vs advisory

`semanticFingerprint` governs the interface contract and execution constraints that must remain stable for compatibility and validation. It does not claim to encode every possible meaning of the implementation.

### A2. Necessary, not sufficient

Matching `semanticFingerprint` is necessary for interface-level CID compatibility, but it is not sufficient to prove broader behavioral equivalence.

## Five-slot profile

`fingerprintProfile` is additive and optional.

Only the `interface` slot is populated in this card.

The profile reserves four additional slots for later work:

- `strict`
- `effects`
- `semantic`
- `behavior`

Those slots are declared now so successor work can attach new CID dimensions without changing the existing identity hash contract.

## Current scope

The current CID semantics scope covers:

- ports
- `language.primary`
- `validation.evidenceRequired`
- `performanceBudget`

The scope intentionally does not include AST semantics, LLM embeddings, or effect tracking.

## Broker read/write dependency admission

Broker admission uses CID identity as one dimension of a conservative static dependency check. A `WriteIntent` may declare `readAtoms` in addition to its write-side `atomRefs`; when that intent becomes active, the broker registry persists the declared read atom IDs and CIDs as optional active resource keys.

This makes read/write dependency admission symmetric at the declared atom level:

- a new intent reading an atom currently written by an active intent is blocked or routed to serial review;
- a new intent writing an atom currently read by an active intent is also blocked or routed to serial review.

This rule is intentionally scoped to declared `readAtoms`. It is not dynamic runtime read tracking, and it does not claim to discover hidden effects that an adapter or agent failed to declare. Those residual risks remain validator, CAS base-hash, or fail-closed concerns.

## Canonical mapping

- `semanticFingerprint` maps to `CID.Interface`
- `fingerprintProfile.interface` is the additive schema home for the existing contract/interface and execution-constraint surface

## Compatibility promise

The schema change is additive:

- `fingerprintProfile` is optional
- `additionalProperties: false` remains in force
- existing fixtures and registry entries must continue to validate unchanged
