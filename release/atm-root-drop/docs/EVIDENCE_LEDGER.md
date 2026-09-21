# Evidence Ledger

ATM separates evidence by lifecycle instead of treating every JSON file as Git history.

## Storage policy

New command output, validator details, telemetry and per-task evidence envelopes are ephemeral payloads. They are written below `.atm/runtime/evidence-ledger/`, addressed by SHA-256, and indexed by work-item id. This tree is runtime state and must be ignored by Git.

Only compact, offline-verifiable governance receipts are Git-eligible. The durable allowlist is defined by `EVIDENCE_STORAGE_POLICY.durableKinds` and currently covers bundle manifests, checkpoints, closure packets, runner publication recovery, runner-sync receipts, and seal-and-commit receipts. Adding another durable class requires changing that policy and its boundary tests.

Files already present below `.atm/history/evidence/` are bounded legacy inputs. ATM may read and migrate them, but new runtime payloads must never be written there.

## Offline access and checkpoints

Each runtime object stores its work-item id, original evidence record, and digest. `verifyEvidence` recomputes the digest before returning trust. A checkpoint is the digest of the sorted object-digest set, so it can be verified without Git or a remote service.

The migration manifest records every legacy source path, work-item identity, source digest, ledger digest and verification result. It also records the count and bytes of already tracked legacy files separately from the payload bytes that future writes will avoid adding to Git.

## Export and restore

Run `scripts/migrate-evidence-ledger.ts` against the repository to import legacy envelopes without deleting them. The exported manifest and the content-addressed `records/` objects form the portable restore set. `restoreEvidenceLedger` restores into an empty store and fails closed when an object is missing, malformed, has changed identity, or produces a different checkpoint.

## Non-destructive cutover

1. Record the tracked legacy count and byte baseline.
2. Run migration without deletion and require every record to report equal source and ledger digests.
3. Restore into a fresh store and verify the checkpoint.
4. Switch production writers and readers to the canonical evidence path policy.
5. Keep legacy reads enabled while all existing history remains untouched.
6. Disable legacy reads only in a later governed release after external adopters have migrated.

This task does not rewrite Git history. Existing repository size therefore does not shrink; only future runtime-evidence growth is removed.

## Garbage collection safety

Garbage collection may remove only runtime objects that are not referenced by a work-item index, checkpoint, export manifest, or durable receipt. It must first produce a dry-run inventory and must never delete legacy history or a durable allowlisted receipt. If reachability is ambiguous, retain the object.
