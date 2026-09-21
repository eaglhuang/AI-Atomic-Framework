# Benchmark evidence v2 and independence

This contract is instrumentation, not a claim that ATM has demonstrated an
advantage over worktrees, Git and CI. The v1 manifest and historical results
remain immutable. Never migrate them in place or pool pilot and formal results.

## Public boundary

`parseBenchmarkV2` consumes an unknown JSON value and returns a detached v2 run
record. It rejects unsupported versions, missing fields, invalid measurements,
duplicate operation identities and inconsistent denominator assignments. It
does not coerce strings, fill defaults, infer completion, fetch evidence or write
files. The JSON Schema covers structure; the parser additionally enforces
cross-field semantics. Consumers must use both via the parser.

`assertSealedBytes` checks a caller-supplied SHA-256 over original bytes, not
reformatted JSON. Obtain the expected digest from the independently retained
seal, never recompute the expected value from the candidate under review.
The v1 fixture has a byte-preservation regression test; that test does not
authenticate a remote dataset or prove an external experiment occurred.

## Operations and costs

Every operation has an identity, oracle truth, observed decision and denominator
eligibility. Known benign operations with known decisions belong to the false
block denominator; known conflicts with known decisions belong to missed
conflict. Unknown truth or decision is unavailable, never a negative outcome.
Report missing-decision counts against all known-truth operations separately;
do not silently drop missing observations to obtain a favorable safety rate.
Missing observations can prevent the later decision policy from passing.

An empty operation list is representable, including aborted runs, but provides
no safety estimate. Zero denominators must remain unavailable in aggregation.
Run, pair and cluster identities preserve the units required for paired,
cluster-aware analysis. Completion is explicit: completed, failed, aborted or
unknown. Failed and aborted runs remain part of the experiment record.

Token counts, billed cost, human minutes and compute cost use explicit null for
unknown. Zero means measured zero. Known billing and human time require source
references even when zero. The parser checks reference shape, not source
authenticity. Usage counts do not prove payment; token-times-price estimates
must not be entered as billed cost. Currency conversion, human rates, allocation,
startup/steady-state breakdown and uncertainty belong to the preregistered
measurement policy and attributable raw telemetry, not implicit parser defaults.

## Evidence verification and levels

`assessIndependence` and `assessGates` require an injected verifier. Without one,
references confer no readiness or independence upgrade. Verification failures
and exceptions fail closed. A callback returning true in a unit test is a test
double, not real-world evidence.

The verifier must retrieve the referenced bytes, check their digest, bind them
to the current protocol, run, pair and environment, and verify the relevant
claim and trusted authority. A digest or a self-supplied signing key alone is
insufficient. Controller verification must establish actual organizational
control, not accept different identity strings as proof. Isolation verification
must include denied-access negative controls for host workspaces, hidden labels,
other arms and shared conversation state. This contract defines the boundary;
environment, telemetry and corpus tasks supply the verifiers.

| Level | Required verified facts |
| --- | --- |
| internal-cross-check | No verified isolation; no external claim |
| isolated-internal | Isolation verified; external control not established |
| external-operator | Isolation and control verified; operator outside sponsor control |
| external-custody-adjudication | Above plus sponsor, operator, custodian and adjudicator have distinct controllers |

Multiple accounts, agents, models or signing keys under one controller never
upgrade the level. Contradictory actor/key ownership downgrades the claim. A
subagent sharing the host filesystem is not isolated merely because its chat
is empty. Role-level independence also does not prove unbiased scenario design,
complete blinding, statistical power or reproducibility; disclose these limits.

## Temporal gates

Pre-run readiness requires verified public-package evidence and the sealed
corpus. It must not require adjudication or final telemetry that can only exist
after execution. Post-run readiness additionally requires verified adjudication
and telemetry. A post-run receipt cannot compensate for an absent pre-run seal.
Verifiers must check temporal ordering, scope and provenance, not just presence.
Budget, credentials, safety policy and execution readiness remain separate
requirements; these two data gates alone never authorize paid execution.

Keep raw runs, private corpus and billing exports outside Git. Store small
digest-addressed references and public methodology in Git; verify retrieval and
restoration from a clean reader. This contract introduces no alternative ATM
task ledger and does not modify the existing v1 runner.
