# Cross-Vendor Team Markdown Handoff Ledger

## Authority And Storage

This contract applies to adopter repositories governed by ATM. The framework
ships the schema, CLI, renderer, validators, and fixtures. It never stores an
adopter's real provider output or handoff history.

During a run, the Coordinator/system-only lane writes canonical JSON under
`.atm/runtime/handoff/<task-id>/<team-run-id>/`. A close, abandon, terminal
provider failure, or failed close promotes the verified runtime ledger to
`.atm/history/handoff/<task-id>/<team-run-id>/` through the task-attached
closure or archive-only lane. Runtime handoff files are generated state, never
independent Git residue or a hand-committed artifact.

`atm.teamRoleHandoffArtifact.v1` is a reference envelope for
`atm.teamProviderRunArtifact.v1`. It contains the ordered source reference,
hash, role/provider routing, lease epoch, redaction metadata, `humanSummary`,
and optional lifecycle-derived `routeNote`; it does not copy a complete vendor
response. The manifest forms a SHA-256 chain and records the root hash and
`runOutcome` (`running`, `completed`, `aborted`, or `failed`).

## Markdown Projection

`index.md` is an ATM-generated, deterministic narrative projection. Its
frontmatter identifies the task, run, manifest reference/hash, timestamps, and
transition count. Each transition may contain only JSON whitelist fields:
`humanSummary`, decision vocabulary, validator verdict, route note, source
artifact reference, and hashes. Full output, private reasoning, unredacted
text, secrets, and arbitrary provider fields are forbidden.

JSON remains the only authority for permissions, scope, claims, close, task
state, hashes, and evidence. Markdown is neither a second database nor a
prompt source. A reader may inspect it, but provider context is rebuilt by the
Coordinator from canonical JSON after scope, manifest/hash, and secret checks.

## Gates And Context

`handoff.materialize` is exclusive and Coordinator/system-only. The hard gate
requires the exact task/run plus the Team run's bound actor and Coordinator
role; a caller cannot obtain either gate merely by passing `--actor
coordinator`. Provider bridges, workers, reviewers, and validators cannot
write handoff JSON or Markdown. `handoff.read` is shareable but scope-required
and Coordinator mediated: the builder injects only role-limited envelopes.
Cross-task paths, unfinished prior runs, and direct provider history access
fail closed.

Continuation reads require the same task, a terminal prior run, an explicit
Coordinator selection, and the `handoff.continuation-consumed` event. The
single context budget source is 256 tokens per artifact, four artifacts, and
1,024 tokens total. Adapters record an actual tokenizer count when available,
or an estimator identifier and estimate otherwise.

Sequence allocation is Coordinator/system serialized and lease-epoch fenced.
Missing artifacts, hash/chain/sequence/task-run/frontmatter mismatches,
encoding failure, or secret-scan failure use the canonical
`handoff-integrity-blocked` reason and block consumption.

## Retention And Patrol

At 48 transitions or 384 KiB, patrol emits a soft retention warning. At 64
transitions or 512 KiB, materialization stops with
`decisionClass=human-signoff-required`; a Captain must choose a no-more-handoff
continuation or split the task/run. The hard stop carries the controlled
`handoff-hard-limit-reached` status code rather than an unstructured error.
`team handoff stats` exposes the diagnostic.

Close-preflight and daily-noon patrol verify the manifest, chain, sequence,
frontmatter, deterministic whitelist projection, UTF-8 encoding, retention,
and missing terminal-run archival. The framework's deterministic fixtures test
materialization, integrity tamper blocks, context budget, aborted promotion,
and narrative whitelist drift.
