---
applyTo: "**"
---


# ATM Residue Cleanup

Use this skill after a governed operation creates transient artifacts or ends
outside its normal success path.

1. Run `node atm.mjs cleanup diagnose --json` first. Treat its ownership and
   staged-index classifications as authoritative.
2. Use `node atm.mjs cleanup apply --json` only for receipt-safe entries. It
   must not be used to delete user-authored source, staged foreign changes, or
   artifacts held by an active owner.
3. If an operation cannot restore its bytes, retain or create an
   `atm.operationCleanupReceipt.v1` through the owning operation and transfer
   recovery only with a durable owner lineage. Do not release the operation's
   queue, claim, or lock as a shortcut.
4. Cleanup completion does not make a failed build, test, or publication pass.
   Preserve the original failure and report the recovery disposition.

Keep this flow inside ATM CLI routing. Preserve host edits and rely on install manifest hashes for uninstall safety.
