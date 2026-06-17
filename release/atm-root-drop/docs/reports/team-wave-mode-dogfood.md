# Team Agents Wave Mode — Dogfood Report

Status: complete
Source task: TASK-MAO-0033
Benchmark: `scripts/validate-team-wave-mode.ts`
Fixtures: `scripts/fixtures/team-wave-mode/wave-scenarios.json`

## Purpose

Exercise the full Team Agents Wave Mode pipeline end to end against realistic
fixtures and confirm the safety behaviors specified in
`docs/specs/team-agents-wave-mode-v1.md`. The fixtures are modeled on the
broker-format-adapter family shape: several sibling cards each delivering a
disjoint adapter file plus a shared, append-safe coverage map.

## Pipeline under test

```
planWaves (0024) → admitWave (0026) → createTeamWaveEnvelope (0025)
   → worker reports (0028) → sliceWaveEvidence (0029) → checkpointWave (0030)
```

The coordinator-only closeout guard (0031) and validator/reviewer roles (0032)
gate which role may drive privileged actions. Lifecycle authority stays with
`batch checkpoint` / `taskflow close` — the dogfood never closes a card.

## Scenarios and results

| Scenario | Setup | Expected | Result |
|----------|-------|----------|--------|
| safe-wave | 2 disjoint adapter cards, shared append-safe map | one wave, both admitted | ✅ both admitted |
| unsafe-wave-same-deliverable | 2 cards delivering the same registry file | fail closed, 1 admitted | ✅ second deferred (cid-conflict / scope-overlap) |
| mixed-wave-dependency | 1 ready card + 1 with an open dependency | 1 admitted, 1 deferred | ✅ deferred member cites `dependency` |
| per-task slicing + close-readiness | clean safe wave diff sliced per task | all done members close-ready | ✅ every done member close-ready |
| needs-review gating | wave diff with an unattributed file | no member close-ready | ✅ whole wave gated to needs-review |

All five scenarios pass deterministically via
`node --strip-types scripts/validate-team-wave-mode.ts`.

## Key validations

- **Safe wave** admits in parallel only when scope is disjoint (append-safe map
  excepted), dependencies are external, target repo and closure authority match.
- **Unsafe wave** fails closed on same-deliverable write/write rather than
  admitting both workers.
- **Mixed wave** admits the ready member and defers the dependency-blocked member
  to a later wave; no card is dropped.
- **Per-task slicing** attributes every changed file to exactly one card; the
  append-safe coverage map is attributed to all owners without being flagged
  ambiguous.
- **Close-readiness** is granted only to `done` members backed by clean
  attributed evidence; a single unattributed file forces the whole wave to
  `needs-review` and blocks all close input.

## Conclusion

Wave Mode behaves as specified: it accelerates safe multi-card work while failing
closed on every unsafe combination, and it never short-circuits the existing
close lane. The benchmark is wired as the command-backed validator for
TASK-MAO-0033 and can be re-run as a regression check for the wave-mode surface.
