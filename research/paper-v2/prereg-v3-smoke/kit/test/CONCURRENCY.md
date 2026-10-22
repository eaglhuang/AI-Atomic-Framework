# Stubbed multi-session concurrency suite (#367)

Run from the repository root with Node 24, Python 3 and Git on Linux:

```sh
npm ci --ignore-scripts
bash research/paper-v2/prereg-v3-smoke/kit/test/run-concurrency-suite.sh
```

The existing Product CI workflow runs its CLI sweep on every PR, including all
four #367 path families. `tests/cli/stub-concurrency-suite.test.ts` is discovered
by that sweep and uses its default parallel scheduling with independent fixtures.
The wrapper caps the suite at 170 seconds within the sweep's 180-second deadline.
Local validation took 70 seconds; all files remain below the 600-line budget.
There are no model calls, downloaded CLI pins, paid keys, or sealed-run writes.

| #367 sub-item | Tests run by the entrypoint |
| --- | --- |
| Offset ±1/±N, unique fallback, ambiguity, reported offsets (#359) | `tests/cli/unified-patch-locator.test.ts`; kit `hunk-locator-parity.mjs` |
| Stale placement over repeated context (#363) | `tests/core/stale-base-translation.test.ts` (live-write and transactional steward); `tests/core/live-queued-write.test.ts`; `test-stub-concurrency.mjs` exercises actual wrapper placement in both modes |
| Cross-session overlap; v10c rec 3 → rec 5; disjoint and same actor (#360) | `tests/core/cross-session-overlap.test.ts`; `tests/cli/unified-patch-v10c-replay.test.ts` |
| Reject → resubmit → accept; steward attempts/retryCount (#366) | `test-stub-concurrency.mjs` in real and legacy stub modes; `test_writer_metrics_366.py` also distrusts a supplied attempt |
| Mixed EOL, CRLF, EOF, differential vs Git (#362/#361) | `tests/cli/unified-patch-eol.test.ts`, `unified-patch-eof-newline.test.ts`, `unified-patch-locator.test.ts` (seeded -U0/-U1/-U3 oracle) |
| Multi-hunk offsets, overlap, truncated, zero-hunk, multi-file (#361) | `tests/cli/unified-patch-locator.test.ts`; malformed wrapper classifications in `test_writer_metrics_366.py` |
| N processes × M files, zero kit-errors, own commit SHA (#364) | `tests/core/live-write-commit-path.test.ts`: 8 processes × 15 writes over 8 files, every decision accepted and every receipt matches its proposal's commit subject |
| Torn journal, recovery fixtures (#364) | `live-write-commit-path.test.ts`; `test-live-write-journal-parity.mjs` |
| Lock timeout; killed between rename and commit (#364) | `test-stub-concurrency.mjs`: real 30s lock deadline, unchanged file, release/retry; SIGKILL writer group after rename and before Git index operations, then original-proposal recovery attribution |
| Fake codex real-session parity and current stub (#366 E6) | `test-stub-concurrency.mjs`: existing `bin/stub-codex.mjs`, two sessions through actual socket steward, both `PREREG_STUB_WRITE_MODE=real` and `stub`; real mode uses process substitution without base/attempt flags |
| Scorer synthetic arms (#366) | Immutable `test_metrics_366.py`: loss=1, silent loss=0/1, conflict≥1, retries=resubmissions=0/1, proposal attribution, null waits, kit-error invalidation. Exact conflict-count tightening is deferred by owner to the next approved kit generation. |

The integration fixture supplies a **test-only source CLI bridge**: the kit's
version handshake expects protocol `0.1.21`, while every write is executed by
this checkout's `runBroker`. This isolates source regressions without changing
the pinned runbook or claiming published-CLI parity. All repositories, sockets,
Git interception and crash signals are temporary. The crash fixture lets the
product write its own journal; it never fabricates a recovery intent. Existing
lower-level torn-journal and recovery fixtures are reused rather than copied.
The Git interception pauses before `git add`, after observing the changed file
and unchanged HEAD, so SIGKILL leaves no foreign index lock to obscure recovery.

The suite completes only the concurrency-suite exit criterion. Release,
pre-registration, clean real smoke, and formal-run criteria remain separate.
