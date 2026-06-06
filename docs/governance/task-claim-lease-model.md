# Task Claim Lease Model

This document defines the ATM claim lifecycle used for multi-actor collaboration.

## Goal

Prevent two actors from executing the same task concurrently while keeping handoff and takeover auditable.

## CLI Surface

`node atm.mjs tasks claim|renew|release|handoff|takeover --json`

Core options:

- `--task <work-item-id>`
- `--actor <actor-id>` (or `ATM_ACTOR_ID`)
- `--files <csv>` for claim or takeover scope
- `--ttl-seconds <number>` for lease ttl
- `--to <actor-id>` for handoff
- `--reason <text>` for release, handoff, takeover

## Claim Record

Claim data is persisted under each task JSON as `claim`:

- `actorId`
- `leaseId`
- `claimedAt`
- `heartbeatAt`
- `ttlSeconds`
- `files[]`
- `state`: `active` | `released` | `handoff` | `taken_over`
- `handoffTo` (optional)
- `reason` (optional)

## Lock Conflict Behavior

- Claim acquisition calls governance lock store.
- Lock store uses atomic file creation semantics (`wx`) for active lock writes.
- Existing active lock returns conflict (`ATM_LOCK_CONFLICT`).
- Released tombstone records are treated as stale and can be overwritten by a new active lock.

## Takeover Rule

- Takeover is allowed only when the existing claim is stale (`heartbeatAt + ttlSeconds` expired).
- Successful takeover writes a takeover evidence entry to `.atm/history/evidence/<task>.json`.
- Takeover evidence captures previous claim state and new claim state.
