# Transient Artifact Lifecycle

`INV-ATM-014` defines one rule for every governed operation: an operation owns
the transient bytes it creates until they are restored or transferred by a
digest-verifiable recovery receipt.

The public contract is `atm.operationCleanupReceipt.v1`. It records operation
identity, owner lineage, the exact transient path inventory, before/after
digests, primary outcome, disposition, retry token, terminal state, and a
self-digest. It intentionally does not encode incident-specific paths or task
branches.

`atm cleanup diagnose` is read-only. `atm cleanup apply` delegates to the
owner-aware residue classifier and may remove only non-staged, receipt-safe
transient paths with no active owner. It never treats an operation failure as a
success, deletes user-authored source, overwrites foreign WIP, or bypasses a
shared-index owner.

If cleanup cannot prove a safe terminal state, it must retain the recovery
receipt and report the exact owner/recovery route. Releasing a task, queue, or
lease before either terminal outcome is a lifecycle violation.
