# 3. Governed Composition-Commit Protocol, Concurrency and Trust Model

> Status: DRAFTED as specification (DRAFT-zh §3.1–§3.7). Coordinator implementation: PR #297 (`cb252424…`, schema `atm.sharedComposeInbox.v1`) as recorded in `P/EVIDENCE_INDEX.md` and DRAFT-zh §3.3. Fields still differing from PR #198 are marked as **proposal**. Threat model scope: §1.2.

## 3.1 Participants

| Role | Responsibility |
|---|---|
| Proposer | Produces a patch proposal against a declared base digest; never writes the canonical file. |
| Broker | Admission (v1 seven-layer gate); routes same-file bounded-disjoint intents to composition. |
| Batch closer | Decides which proposals belong to a batch and when the batch is sealed. |
| Composer | Deterministically composes the members of a batch on one immutable base, or emits a blocked receipt. |
| Validator | Checks the composed result against the contract (§4) before commit. |
| Neutral steward | Sole apply authority; performs digest revalidation and the canonical replacement. |

## 3.2 State machine

`proposed → eligible | blocked → batched → composed → validated → committed`, with side branches `aborted/retryable → reproposed | exhausted`. Only `committed` counts as completed work. A proposal that reaches `blocked` must leave the canonical file byte-identical and must produce a receipt with a reason code; a proposal never reaches `committed` twice (idempotent resubmission).

## 3.3 Shared compose inbox (PR #297)

The coordinator realizes the batch closer and composer roles across independent writer processes:

- **Window.** `composeWindowMs` defaults to 0, which seals each proposal as a singleton batch; a singleton cannot support C2′. The HIST-v2 `atm` arm uses 2,000 ms (prereg §5).
- **Immutable base.** Each batch composes against the base captured when its window opened.
- **Accepted subset.** Members are considered greedily in `(arrivedAt, proposalId)` order; legality of the accepted set is checked with `git merge-file` over every member order, bounded by `legalProofMaxMembers = 8`.
- **Commit.** One rename per accepted subset: temp file + fsync + rename + best-effort parent-directory fsync. This is a file replacement, not a Git commit.
- **Idempotence.** Resubmitting the same proposal id returns the existing outcome.
- **Late joiners.** A proposal arriving after its batch sealed is marked `late = true`, processed with a zero window, and recomposed as `merge-file(currentFile, declaredBase, apply(declaredBase, patch))`.
- **Deadline and retries.** A 30 s deadline measured from `firstSubmittedAt`; attempt 0 plus at most 8 retries.

**Terminal states.** `committed/success` (acknowledged within the window), `durable-unacked`, `late-commit-after-timeout`, `timeout`, `retry-exhausted`, `reconciliation-incomplete`. Throughput counts only `combined_success`; a rename that lands after the deadline is **not** success even if bytes are correct, and an acknowledgement inconsistent with the final state is classified `inconsistent` (this is exactly the condition that stopped the HIST-v2 pilot-r2; see 06c).

## 3.4 Commit boundary

Digest revalidation of the canonical file and its replacement must occur **inside the same mutual-exclusion section**. Any check-then-write split (validation outside, write inside, or vice versa) admits the lost-update race demonstrated by the r3 barrier fault (06a). The implemented mutual exclusion is layered (§4.11 d1–d4): a repo-scoped lock directory keyed by the canonical real path, a kernel advisory lock acquired through SQLite `BEGIN IMMEDIATE` with a bounded wait, and an optional per-target FIFO apply queue.

## 3.5 Concurrency model

- Writers are independent OS processes on one host; they may share or not share `TMPDIR` and PID namespaces (both were fault-tested: 06a, Table R5).
- Proposals are prepared in parallel; composition is batched; canonical commit is serialized per target file.
- Liveness is bounded, not guaranteed: lock waits (2,000 ms) and queue waits (10,000 ms) end in `recovery-required` or retry, and the per-proposal deadline ends in a timeout terminal.
- Orphan temporary files from crashed writers are cleaned only by a lock holder; live temp files of a current holder are reported as `skippedLiveHolder` and never deleted.

## 3.6 Trust model

| Assumption | What is checked | What is **not** claimed |
|---|---|---|
| Cooperative writers | Every governed write entry point performs a role-consistency check (proposer ≠ steward) | Identity authentication; a forged identity by a malicious local process |
| Trusted steward | Steward re-validates base digest and contract before replacement | Byzantine steward |
| Trusted file system | Atomic rename; fsync where available | Crash/power-loss durability; multi-file atomicity |
| Monitored paths | Writes outside the governed path are detected on monitored paths | "Not observed on monitored paths" ≠ "cannot write" |
| Failure handling | Compensation: blocked/rolled-back receipts, recovery-required | Crash atomicity |

We therefore call P0-4 a **role-consistency check**, not an identity guarantee.

## 3.7 Receipts and minimum event fields

Receipt kinds: `committed`, `blocked` (with reason code, e.g. `steward-final-patch-required`, `invalid-steward-identity`, hash drift, recompose mismatch), `rolled-back`, `recovery-required`. Every receipt carries at least: proposal id, batch id, target file, declared base digest, observed pre-commit digest, post-commit digest (if any), accepted set, outcome, attempt number, and timestamps for first submission, batch seal and commit. These fields are what HIST-v2's write plants (§5.6) and RQ4 audit against. [TODO-VERIFY: reconcile this field list with the `atm.sharedComposeInbox.v1` schema in PR #297 before submission.]
