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

`node atm.mjs actor register|list|resolve|verify-git|adopt --json`

- `register`: create or update an actor record.
- `list`: show current actor registry entries.
- `resolve`: resolve actor identity from explicit option or environment.
- `verify-git`: compare resolved actor git identity and repo-local git identity.
- `adopt`: atomically claim a new identity for the current session — composes a slug from `--editor` + `--model`, writes the actor record, sets repo-local git config, and updates the runtime identity default in a single transaction.

### Why `adopt` exists

Without `adopt`, a new agent session has to perform four independent mutations to align its identity:

1. `actor register` to ensure the registry has a record.
2. `git config --local user.name <slug>`.
3. `git config --local user.email <slug>@...`.
4. Manually write `.atm/runtime/identity/default.json`.

If any step is skipped, the next `resolveActorId()` call may fall back to the prior session's `repo-default` and commits will be tagged with the wrong author. `adopt` collapses the four steps into one transaction, with the git config snapshotted up front so a mid-transaction failure rolls the repo back to its pre-call state rather than leaving the three caches out of sync.

### `adopt` invocation

```
node atm.mjs actor adopt
  --editor <editor-slug>   # required (e.g. claude-code, vs-code, codex)
  --model  <model-slug>    # required (e.g. opus-4-7, gpt-5-mini)
  --kind   <human|ai-agent|automation>   # default: ai-agent
  --session <sessionId>    # optional, recorded on runtime default
  --name   <display-name>  # optional, defaults to slug
  --git-name / --git-email # optional overrides; default to <slug> and <slug>@atm.local
  --json
```

Evidence on success includes `actorId`, `previousActorId` (whatever the runtime default held before), `gitConfigChanged`, `runtimeDefaultPath`, and `registryPath`.

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
