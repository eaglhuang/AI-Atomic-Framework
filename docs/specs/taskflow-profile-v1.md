# Taskflow Profile v1 Specification

This document defines the `taskflow.profile.v1` schema contract for the ATM taskflow sub-command.

## Objective

The `taskflow.profile.v1` schema specifies the capabilities and delegation configuration for a planning repository profile when operating under the target repository's taskflow orchestrator.

## Invariants

1. **Read-Only Orchestration**: The taskflow sub-command remains read-only (dry-run mode). Real ledger edits must be delegated to the repository-local opener.
2. **Schema ID Verification**: Every profile must contain a `"schemaId"` field exactly equal to `"taskflow.profile.v1"`.
3. **No Write Permission**: If a profile attempts to specify `"supportsWrite": true`, it must be rejected to prevent accidental target-repo modifications.

## JSON Schema

Refer to [taskflow-profile.v1.json](../../schemas/taskflow-profile.v1.json) for the full JSON Schema definition.
