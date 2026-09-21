# Model-Bound Agent Capability Benchmark and Dispatch Routing

## Purpose

ATM may use benchmark evidence to choose an AI worker, but capability evidence
is bound to a specific model configuration. It is not a permanent property of a
provider, editor, captain alias, or product family.

The canonical evidence key is:

```text
provider + exact model identifier + reasoning profile + benchmark id/version
+ observed date + tool/adapter context
```

If any member of that key changes, the prior score is historical evidence only.
It must not be inherited by the new configuration without a fresh benchmark.

## Provisional Snapshot: BENCH-ATM-001

- Observed: 2026-08-16
- Benchmark: `BENCH-ATM-001`, version 1
- Reasoning profile: Medium for every candidate
- Comparison mode: same sealed assignment and isolated output directory
- Status: provisional, single-benchmark evidence
- Review deadline: 2026-11-14, or immediately after any refresh trigger below
- Model labels: operator-reported exact labels for this run; they are not
  aliases for future models in the same product family

| Capability (0-10) | Codex / `5.6 Terra` / Medium | Antigravity / `Gemini 3.7 Flash` / Medium | Cursor / `Grok 4.6` / Medium | Claude / `Opus 5` / Medium |
|---|---:|---:|---:|---:|
| Dispatch comprehension | 9.0 | 8.0 | 9.5 | 9.0 |
| Root-cause diagnosis | 9.5 | 9.0 | 9.3 | 9.7 |
| Authority and digest security | 9.0 | 8.2 | 8.8 | 9.3 |
| Rollback atomicity | 9.5 | 9.5 | 9.7 | 9.7 |
| TDD and test design | 8.5 | 9.0 | 9.2 | 10.0 |
| Hidden-edge resilience | 8.5 | 8.2 | 8.6 | 9.2 |
| Generalization and deep-module design | 9.5 | 9.0 | 9.5 | 8.8 |
| Readability | 9.5 | 9.0 | 9.5 | 8.8 |
| Execution efficiency | 9.2 | 10.0 | 9.0 | 7.8 |
| Report credibility | 8.5 | 8.0 | 9.3 | 9.5 |
| Weighted total (0-100) | **90** | **87** | **91** | **92** |

All four implementations satisfied the benchmark's core public contract. The
scores distinguish observed strengths and risks; they are not pass/fail labels.

Observed routing preferences for this snapshot:

| Work shape | First preference | Second preference |
|---|---|---|
| Architecture, generalized rule design, captain arbitration | Codex `5.6 Terra` Medium | Claude `Opus 5` Medium |
| High-risk root cause analysis and security-focused tests | Claude `Opus 5` Medium | Codex `5.6 Terra` Medium |
| Balanced product implementation and closeout | Cursor `Grok 4.6` Medium | Codex `5.6 Terra` Medium |
| Fast, bounded small modules | Antigravity `Gemini 3.7 Flash` Medium | Cursor `Grok 4.6` Medium |
| Publication, runner, and queue workflows | Cursor `Grok 4.6` Medium | Claude `Opus 5` Medium |
| Independent review | Claude `Opus 5` Medium | Cursor `Grok 4.6` Medium |

## Dispatch Rules

1. Match the task's required capabilities before consulting benchmark rank.
   Benchmark rank is a routing aid and tie-breaker, never write authority.
2. Put the exact model identifier and reasoning profile in every dispatch and
   require the worker's first report line to repeat them.
3. Do not route by a captain alias alone. `Claude captain`, `Cursor captain`, or
   a provider name does not identify the tested configuration.
4. A model with no current matching benchmark is `unbenchmarked`; it does not
   inherit a predecessor's score. Use a bounded evaluation or conservative task.
5. Comparisons across different reasoning profiles require an explicitly
   normalized benchmark. Medium, High, and Low results are separate evidence.
6. Preserve raw reports, timing, test counts, and known counterexamples. A total
   score without those observations is not sufficient dispatch evidence.

## Refresh Triggers

Re-run the benchmark and append or supersede this snapshot when any of the
following occurs:

- the exact model identifier, release, or provider-side model revision changes;
- the reasoning profile, context budget, system prompt, tool permissions, or
  editor/adapter changes materially;
- the benchmark assignment, hidden tests, scoring weights, or time limit changes;
- a production incident materially contradicts a recorded strength or risk;
- the review deadline is reached; or
- a new model may plausibly outperform the current routing preference.

Never silently rewrite historical scores. Add a new dated snapshot, name the
superseded evidence, and explain whether the comparison remained equivalent.

## Reporting Contract

External worker reports must begin with one line in this shape:

```text
AI Captain: <captain/runtime> | Provider/Model: <exact identifier> | Reasoning: <profile> | Benchmark: <id or unbenchmarked>
```

If the runtime cannot prove the exact model identifier, it must report
`unverified` rather than guessing. Incorrect self-identification lowers report
credibility and prevents automatic reuse of that run as benchmark evidence.
