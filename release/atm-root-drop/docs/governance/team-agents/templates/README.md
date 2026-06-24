# Team Agents Templates

These templates define advisory coordination artifacts for Team Agents. They are
Markdown-first and do not replace ATM ledgers, evidence, validators, or
taskflow close gates.

## Knowledge Shards

Use `team-memory-shard-template.md` for human-reviewable knowledge shards.
Canonical shards belong under `.atm/knowledge/**` in the repository that owns the
lesson.

Generated manifests, inverted indexes, compacted views, and embedding caches
belong under `.atm/runtime/knowledge/**`. Those files are cache-only and must be
rebuilt from canonical shards; validators reject treating them as canonical
knowledge input.

Framework-only knowledge describes ATM behavior and should stay in framework
docs or governed framework shards. Project-local knowledge describes adopter
repositories and must not become a framework rule without a governed task.

The knowledge layer is advisory. It may suggest context, risks, and validators,
but it is not a second registry, task store, promotion path, claim source, or
closure authority.
