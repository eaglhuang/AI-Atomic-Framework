---
name: atm-memory-consolidate
description: Reflective consolidation pass over a repository's keep-memory notes — merge duplicates, retire stale entries, rebuild the summary index.
argument-hint: "<ATM context>"
charter-invariants-injected: true
---


# ATM Memory Consolidate

Use this skill when a repository's memory-note layer (keep-memory directory)
needs consolidation: the summary index is over budget, stale-report lists
candidates, or a milestone closed and status notes have piled up. The target
directory and index location come from the repository's keep registry entry
(in the coordinating workspace: `docs/keep.registry.md`); the note contract
lives in the keep-memory directory's README.

First command:

```bash
node atm.mjs next --prompt "$ARGUMENTS" --json
```

## Phase 1 — Take stock

- Read the keep summary's memory index section and list the memory directory.
- Run the host repository's own memory tooling for ground truth (its
  validate and stale-report commands, if provided).
- Mark overlapping, stale, and thin notes.

## Phase 2 — Consolidate

- Separate durable from dated: `gotcha`/`feedback` notes tend to be durable —
  sharpen them; `status` snapshots expire — retire them or fold the lasting
  takeaway into a durable note.
- Merge notes describing the same trap or workflow; keep the richer file.
- Convert every relative time reference into an absolute date.
- Delete what the formal record already keeps (backlog, task cards, consensus
  shards, git history) — memory notes carry only operator intuition.
- Propose promotion for gotchas stable for six months or longer: list them
  for HUMAN review as consensus-shard candidates. Never mutate the consensus
  layer (keep-shards) from this skill.
- Mark corrected notes `superseded` or fix them in place; never leave a known
  false assertion active.

## Phase 3 — Tidy the index

- Rebuild the index with the host repository's own tooling (its
  rebuild-index command, if provided); confirm the index
  section stays within its line budget.
- Report files touched, retired, merged, and promotion candidates awaiting
  human review.

## Charter Invariants

{{CHARTER_INVARIANTS}}

## Guardrails

- Stay inside ATM CLI routing and evidence contracts.
- Do not create a parallel task model, registry, or approval flow.
- Do not build a second memory store or copy notes across repositories; the
  registry routes readers to each repository's own notes.
- Consensus-layer promotion is always a human decision.
