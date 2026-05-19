# Actor Identity Model

This document defines the neutral actor identity contract used by ATM governance.

## Goal

The actor model lets ATM govern collaboration for:

- humans
- AI agents
- automation services

without tying core governance semantics to a single editor or host tool.

## Registry Contract

ATM stores actor identities in:

- `.atm/catalog/registry/actors.json`

Document shape:

- `schemaId`: `atm.actorRegistry`
- `specVersion`: `0.1.0`
- `generatedAt`: ISO timestamp
- `actors[]`: actor records

Each actor record includes:

- `actorId`
- `actorKind`: `human` | `ai-agent` | `automation`
- `displayName`
- `provider` (optional)
- `editor` (optional)
- `gitName` (optional)
- `gitEmail` (optional)
- `contact` (optional)
- `capabilities[]` (optional)

## CLI Surface

`node atm.mjs actor register|list|resolve|verify-git --json`

- `register`: create or update an actor record.
- `list`: show current actor registry entries.
- `resolve`: resolve actor identity from explicit option or environment.
- `verify-git`: compare resolved actor git identity and repo-local git identity.

## Identity Resolution Order

When a command needs an actor and `--id` is not provided:

1. `ATM_ACTOR_ID`
2. `AGENT_IDENTITY` (legacy compatibility alias)

Core governance should treat `ATM_ACTOR_ID` as the canonical environment variable.
`AGENT_IDENTITY` remains supported for migration and backwards compatibility.

## Git Identity Check

`actor verify-git` checks:

- `git config --local --get user.name`
- `git config --local --get user.email`

against the actor record fields:

- `gitName`
- `gitEmail`

If either value mismatches, ATM returns a failing result with expected and actual values.
