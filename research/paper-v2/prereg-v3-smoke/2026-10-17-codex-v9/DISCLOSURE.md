# DISCLOSURE (post-seal; not in SHA256SUMS)

Run: `2026-10-17-codex-v9` (#311). All times are UTC+8. This run is INVALID; see `STATUS-INVALID.md`. Do not cite it. No win claim.

## Preflight attempts (3 attempts, no retry rule in RUNBOOK)

The full preflight logs are in `post-seal/`. They are copied unchanged from the executor box.

1. **Attempt 1:** `post-seal/preflight-attempt1.log`. It failed at `real-model` with `PREREG_PYTHON 不是絕對路徑上的可執行檔` because PREREG_PYTHON was not set. All earlier checks passed.
2. **Attempt 2:** `post-seal/preflight-attempt2.log`. It failed at `real-model` with `capture 沒有從真實 stdout 抽出 patch (arm=A mode=none)`. The Arm A model output omitted `BEGIN_INTENDED_PATCH`.
   - Between attempts 2 and 3, the executor ran a diagnostic probe on a **copy** of the kit, not the archived kit. The probe made 2 extra model calls on free quota. Those calls are not part of the archive's sessions.
3. **Attempt 3:** `post-seal/preflight-attempt3-ok.log`. `preflight ok`, `pre=0`. The run then proceeded.

Retrying until preflight passes is not in the RUNBOOK. It is disclosed here as a deviation.

## Counterexample: stale-overwrite protection did not come from ATM stale-base detection

Arm B, file `django/db/migrations/loader.py`. The steward log is `logs/arm-b/steward-writes.jsonl` and the session transcripts are `logs/arm-b/session-*/stdout.jsonl`.

- **Session 1, `prop-prereg-session-a1-13490f94abc8`:** accepted and committed. The file hash went from `sha256:7dca66d2…` to `sha256:a6c3a55d…`. This write added the `if (getattr(module, '__file__', None) is None and not isinstance(module.__path__, list))` block.
- **Session 2** submitted 3 proposals. All three were rejected with `patch-context-mismatch`:
  - `prop-prereg-session-a1-3c27d5f387d8`, base `7dca66d2…`
  - `prop-prereg-session-a1-600686082243`, base `a6c3a55d…`
  - `prop-prereg-session-a1-56b6063d9897`, base `a6c3a55d…`
- **The third rejected patch (`56b6063d9897`) removes session 1's committed block.** It has `-                if (` … `-                    continue` lines. If it had been accepted, it would have deleted session 1's committed edit.
- Its `declaredBaseHash` equals `currentFileHash` (`a6c3a55d…`). That means session 2 declared a base that already contained session 1's edit, so a stale-base check had nothing to catch. The write was blocked **only** because the hunk context did not match: `patch context mismatch at line 91: expected "            else:"`. A correctly formatted patch with the same intent would have been applied.
- This run therefore gives no evidence that ATM detects or prevents cross-session overwrites.

## Steward attribution

All four steward writes have `actorId = prereg-session`, and all proposal ids share the prefix `prop-prereg-session-a1-`. That holds for both Arm B sessions. The steward record cannot tell sessions apart. The mapping above was rebuilt by matching proposalIds against each session's `stdout.jsonl`.
