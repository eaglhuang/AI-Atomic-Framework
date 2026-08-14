---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: atm-residue-cleanup
title: ATM Residue Cleanup
summary: Diagnose and safely reconcile operation-owned transient ATM residue.
command: node atm.mjs cleanup diagnose --json
firstCommand: node atm.mjs cleanup diagnose --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
owner: atm-framework
tier: specialist
installProfiles: [framework-full, role-oriented]
invocationPolicy: model-or-user
companionFiles: []
adapterCapabilityRequirements:
  - "*:charter-injection"
---

# {{title}}

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
