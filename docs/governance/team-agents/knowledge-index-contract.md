# Team Agents Knowledge Index Contract

Team Agents knowledge is advisory memory. It may help agents find prior lessons,
path hints, validator notes, and reuse conditions, but it is never a second task
registry, promotion path, claim source, or closure authority.

## Storage Boundary

Canonical knowledge shards are human-reviewable Markdown or JSON files under
`.atm/knowledge/**`.

Generated knowledge artifacts live under `.atm/runtime/knowledge/**`. This root
is cache-only and may contain manifests, inverted indexes, compacted views, or
future embedding caches. Generated cache files must be rebuildable from
canonical shards and must not be used as canonical input.

The framework repository may ship framework-only guidance under documented
source files such as `docs/governance/team-agents/**`; adopters may keep
project-local knowledge under their own `.atm/knowledge/**`. Framework-only
knowledge describes ATM behavior. Project-local knowledge describes a host
repository and must not be promoted into framework rules without a governed
task.

## Advisory Rules

- Task ledgers remain under `.atm/history/tasks/**`.
- Evidence remains under `.atm/history/evidence/**`.
- Runtime coordination remains under `.atm/runtime/**`.
- Knowledge hits can suggest files, validators, and known risks.
- Knowledge hits cannot claim a task, close a task, change status, bypass
  validators, or override evidence.

## Index Contract

Builders may read canonical shards from `.atm/knowledge/**` and framework docs
that explicitly opt in to Team knowledge. Builders may write generated cache
outputs to `.atm/runtime/knowledge/**`.

Validators must fail closed when a generated runtime cache path is used as a
canonical shard input. This keeps the storage rhythm loose while authoring
lessons and tight at build/close time: agents can draft useful notes freely, but
the index source of truth stays reviewable and deterministic.

## Minimal Shard Shape

Each shard should state:

- task or route context,
- repository scope,
- path and retrieval hints,
- lesson and reuse conditions,
- avoid conditions,
- related validators,
- freshness and retention hints.

The shard format is Markdown-first so humans can review it before any query or
compaction runtime consumes it.
