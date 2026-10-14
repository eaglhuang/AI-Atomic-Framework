# Shared compose inbox contract

`atm.sharedComposeInbox.v1`

This is the coordinator contract for cross-writer batching. The numeric limits come from the frozen HIST-v2 method preregistration at `research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/` (R2-D2, R2-D3, R4-D1, R4-D2, R4-D3, R6-D2). That directory is sealed and is not edited by this implementation.

## Limits

| Field | Value |
|---|---|
| `defaultComposeWindowMs` | 0 |
| `defaultDeadlineMs` | 30000 |
| `maxRetriesAfterFirstSubmit` | 8 |
| `maxAttempts` | 9 |
| `defaultMaxBatchSize` | 32 |
| `legalProofMaxMembers` | 8 |
| `defaultComposingStaleMs` | 2000 |
| `lockWaitMs` | 5000 |

`composeWindowMs` defaults to 0. A proposal is sealed alone against the current file bytes. A positive window is the only way other writers join the same batch.

## Batch and commit

Several processes submit into one inbox. A batch is composed against one immutable base: the file bytes captured when the window opened. The receipt records `batchSize` and the member proposal ids in arrival order. The accepted set key is the sorted unique ids of the accepted members.

A canonical commit is one atomic replace of the target file: write a temp file, fsync that file once, rename it over the target, then best-effort fsync the parent directory. It is not a Git commit object. One accepted subset produces one rename. Each member still gets its own receipt. `renameCount` is 1 for members included in that rename and 0 for members that were not.

Compatible members are those whose `git merge-file` proof is clean. A subset is legal only when every order of `git merge-file` against the window base is clean and the resulting bytes are identical. Conflict stdout is discarded and is never written.

The accepted set is the arrival-order greedy subset: members are considered by `(arrivedAt, proposalId)`, and a member is added only when the enlarged subset is still legal. The result is inclusion-maximal inside the proof bound. The proof is a bitmask over orders, capped at `legalProofMaxMembers` (8). A member past that cap is `rejected-conflict` with detail `legal-proof-limit`. That rejection is not a claim that no larger legal subset exists outside the proof bound.

An empty accepted set writes nothing. A same-line conflict does not reject every member: the earlier arrival stays as a legal singleton when that singleton itself merges cleanly. A later member that is legal alone but illegal together with the accepted set is `rejected-conflict` with stop reason `excluded-by-arrival-maximal-subset`.

## Base movement

Cross-writer batching requires the declared base hash, the window base hash, and the current file hash to be the same. A proposal whose declared base already differs from the file is not mixed into another window. It is recomputed alone, with the window forced to 0 and `late=true`.

Sequential arrival after the base has advanced binds a new immutable base equal to the current file bytes. The compose is `git merge-file(currentFile, declaredBase, apply(declaredBase, patch))`. It is not a late recompose against the previous batch's base. The first bind is attempt 0, not a retry. Adjacent-line edits that `git merge-file` reports as a conflict stay `rejected-conflict`. Conflict detection is not weakened to accept them. The previous commit's bytes stay in place.

A later in-lock change that discards the candidate and forces another compose counts as a retry. A stable-base conflict that the legal subset already resolved does not consume a retry. Retries are a lock wait timeout, a hash mismatch against the sealed base, or that base-moved recompose.

## Deadline, retry, and terminals

`firstSubmittedAt` is the clock at the first submit and does not move. The deadline is 30 seconds unless the caller passes `deadlineMs`. At most 8 retries follow the first submit, so the ninth attempt is the last. A recompose that is another commit attempt counts toward those 8. One `git merge-file` inside one compose, and one fsync inside one atomic replace, do not count as extra attempts.

`effectiveStop = min(firstSubmittedAt + deadlineMs, itemStopAt)` when `itemStopAt` is set; otherwise it is the own deadline. `executableSeconds` is that budget in seconds, `max(0, effectiveStop - firstSubmittedAt) / 1000`. It is not elapsed wall time. `elapsedMs` is recorded separately. A submit that starts 2 seconds after an item whose stop is 30 seconds has `executableSeconds` 28 and still counts as a submission.

If the coordinator observes the deadline before rename, it does not rename. The temp is not promoted. The terminal is `timeout`.

`late-commit-after-timeout` is used only when the recorded rename timestamp is after that proposal's effective stop. `durable-unacked` is a rename at or before the stop whose ack is missing, or whose ack timestamp is after the stop. `retry-exhausted` is the terminal when the ninth attempt still cannot commit; stop reason `retry-limit`; no rename.

Entry points are explicit `registerSharedComposeEntryPoint` / `stopSharedComposeEntryPoint` records. They are not inferred from an in-flight submit. While any explicit entry point is still live, a terminal that would otherwise be final is stored as `reconciliation-incomplete`, with the classified terminal kept on `resolvedTerminal`. `writeReceipt` overwrites a receipt only in that state. After every entry point has stopped, `reconcileSharedComposeProposal` writes the resolved terminal. Resubmitting a proposal id that already has a final receipt returns that receipt and does not rename again.

If any member of a sealed batch is already past its effective stop, the batch is not renamed. There is no partial apply. Every member of that batch is `timeout`. The stop reason is that member's own clock: `item-stop` when the member's item stop has been reached, otherwise `own-deadline`. A member that was still inside its own budget receives `own-deadline` as well, because the batch refusal is not a separate stop reason.

## Cleanup and scope

Temp files are named `.${basename}.tmp-compose-${pid}-${hex}`. Cleanup removes a temp only when its pid is not alive. `EPERM` from a liveness probe counts as alive. A dead pid's temp may be removed. This does not use the kernel advisory lock as a liveness signal.

Receipts keep the proposal scope, ticket, and validators. The coordinator does not widen them.

Disk records are compact JSON: one `JSON.stringify` value plus a trailing newline.
