---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-deep-module-refactor
title: ATM Deep Module Refactor
summary: Review replaceable deep-module refactor candidates through a provider-neutral ATM receipt.
command: node atm.mjs next --prompt "$ARGUMENTS" --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

Use this skill when a task asks whether a scattered policy cluster should
become a deeper ATM module or provider-neutral refactor card. The provider is a
replaceable reference input. Matt Pocock's skills are cited for vocabulary and
review heuristics, but ATM runtime authority stays in the sealed review receipt
and task card contracts.

## First Command

```bash
{{firstCommand}}
```

## Provider Contract

Callers submit one bounded refactor candidate plus observed friction. The
provider returns one `atm.deepModuleReviewReport.v1` receipt. Callers do not
copy deep-module rules into production logic.

The review uses the vocabulary `module`, `interface`, `seam`, `adapter`,
`depth`, `leverage`, and `locality`.

Actionable triggers:

- repeated bugs
- shotgun changes
- duplicated policy
- caller complexity
- private-internal tests
- missing test seams

File length is advisory only. It cannot by itself require refactoring. Urgent
fixes default to the smallest generalized repair; broader deepening becomes a
governed follow-up unless a test seam is required for the fix.

## Review Rules

1. Preserve the public interface, owner atom or map, rollback path, and causal
   validators.
2. Apply the deletion test: if deleting the module removes little complexity,
   the module is too shallow.
3. Treat the interface as the test surface.
4. Require two concrete adapters before introducing a replaceable seam.
5. Classify dependencies as in-process, local-substitutable, remote-owned, or
   true-external.
6. Use replace-don't-layer tests through the proposed interface.

## Progressive Disclosure

Read `references/deepening.md` only when dependency classification or
replace-don't-layer testing is the decision point.

Read `references/design-it-twice.md` only when the user asks for alternative
interfaces or the first proposed interface is too shallow. Do not load report
scaffolding or broad codebase history by default.

## Skill Definition

```json
{
  "schemaId": "atm.skillDefinition.vNext",
  "specVersion": "0.1.0",
  "provider": {
    "providerId": "matt-pocock-deep-module-reference",
    "version": "2026-07-24.ed37663",
    "provenance": {
      "upstreamUrl": "https://github.com/mattpocock/skills",
      "upstreamCommit": "ed37663cc5fbef691ddfecd080dff42f7e7e350d",
      "sourceDigest": "sha256:c46b49303a81c7fc8934d0f4fbc44382cdecb73942d85d8d7db3523407fff8fa"
    },
    "license": "MIT"
  },
  "capabilities": ["deep-module-review", "refactor-provider"],
  "compatibility": {
    "atmContractVersions": ["atm.deepModuleRefactorProvider.v1", "atm.deepModuleReviewReport.v1"]
  },
  "fallbackPolicy": "degrade-with-evidence",
  "rollbackPolicy": "provider-only",
  "shadowRun": true,
  "promotion": "manual-review"
}
```

Pinned secondary reference digest:
`improve-codebase-architecture sha256:d3682058df92c259b47c36503baa02345d5811758621b5dc03081d5ba0f7b69b`.

Replacing this provider must not change ATM review receipt, task-card,
test-case, claim, or close contracts.

{{CHARTER_INVARIANTS}}
