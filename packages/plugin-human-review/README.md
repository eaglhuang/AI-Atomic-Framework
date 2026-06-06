# Human Review Reference Plugin

This package provides the reference implementation for ATM human review queues and decision logs.

It keeps review decisions outside `packages/core` while still exposing deterministic helpers for queue records, snapshot hashing, markdown projections, and replayable decision logs.

Primary exports:

- `humanReviewPackage`
- `createHumanReviewQueueDocument()`
- `createHumanReviewQueueRecord()`
- `computeDecisionSnapshotHash()`
- `renderHumanReviewQueueMarkdown()`
- `createHumanReviewDecisionLog()`
- `validateHumanReviewDecisionLog()`

The package is intentionally host-neutral and only depends on upstream core and plugin-sdk contracts.