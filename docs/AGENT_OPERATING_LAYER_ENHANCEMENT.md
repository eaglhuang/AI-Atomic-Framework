# Agent Operating Layer Enhancement

This document describes the planned enhancements to the ATM Agent Operating Layer.
The enhancements introduce an **AtomicCharter authority model** and an
**Integration Adapter Layer** on top of the existing Agent Operating Layer.
Neither addition touches `packages/core` contracts.

## Motivation

ATM already ships a robust governance core (Core Contracts, Evidence-Driven
Evolution, Default Governance Bundle, Plugin SDK). The gap is at the entry layer:
a new AI agent dropped into an unfamiliar repository may not know how to find and
follow ATM rules before it begins editing files. This enhancement closes that gap.

## AtomicCharter Authority Model

### Problem

Host projects accumulate their own rules, profiles, and instructions over time.
Without a stable authority hierarchy, two things can happen:

1. An agent reads a host rule that contradicts an ATM invariant (e.g., a project
   says "no lock needed for docs") and silently bypasses the governance contract.
2. A framework upgrade introduces a new invariant that the host project never
   learns about because there is no machine-readable way to detect the conflict.

### Solution

ATM ships a **framework-level authority document** — the AtomicCharter — installed
at `.atm/charter/atomic-charter.md` with a machine-readable companion at
`.atm/charter/charter-invariants.json`. The charter is the single authoritative
source for framework invariants. Host rules are secondary.

### Authority Hierarchy

```
AtomicCharter (framework layer)     ← highest authority
    ↑ conflicts require waiver flow
host project rules / profiles       ← secondary
    ↑ extends
single-agent / single-user overlays ← lowest
```

### Enforcement Mechanisms

| Mechanism | Description |
|-----------|-------------|
| `atm doctor` — `charter-integrity` check | Verifies charter file exists and hash matches invariants file. Reports `ATM_DOCTOR_CHARTER_MISSING` or `ATM_DOCTOR_CHARTER_HASH_MISMATCH`. |
| `atm next` routing | When `charter-integrity` is unhealthy, `atm next` routes to charter repair before any other governed action. |
| `atm upgrade --propose` gate | Compares proposal against invariants. Blocks with `ATM_CHARTER_INVARIANT_GATE` if an invariant is violated and no `charterWaiver` is present. |
| `atm guard charter --files <...>` | Explicit invariant check against a set of changed files. |

### Charter Waiver Flow

When a host project rule conflicts with an invariant:

1. Open a `behavior.evolve` UpgradeProposal.
2. Add a `charterWaiver` field naming the invariant ID and providing rationale.
3. Obtain a `HumanReviewDecision` before promotion.
4. Bump `charterVersion` major if the invariant itself changes.

Silent override is detected by `atm doctor` and reported as a blocking signal.

### Seed Invariants

| ID | Title | Enforcement |
|----|-------|-------------|
| INV-ATM-001 | No second registry | gate |
| INV-ATM-002 | Lock before edit | doctor |
| INV-ATM-003 | Schema-validated promotion only | gate |
| INV-ATM-004 | No competing highest authority | doctor |
| INV-ATM-005 | Host rule amendments require waiver flow | waiver-required |

---

## Integration Adapter Layer

### Problem

ATM's governance model works when agents read `AGENTS.md` or the repository README
and follow the instructions. But different AI agent environments have different
native entry formats:

- Claude Code reads `.claude/skills/*/SKILL.md` files.
- GitHub Copilot reads `.github/copilot-instructions.md` and `.github/prompts/`.
- Cursor reads `.cursor/rules/skills/`.
- Gemini CLI reads `.gemini/commands/*.toml`.

Without a standard adapter layer, a repository maintainer must manually author and
maintain these files for every agent environment they want to support.

### Solution

A typed `IntegrationAdapter` interface allows each agent environment to be
supported as an installable adapter. Adapters:

1. Write integration files to the agent-native directory.
2. Record every file's SHA-256 hash in `.atm/integrations/manifest.json`.
3. Expose `verify()` for `atm doctor` drift detection.
4. Expose `uninstall(manifest)` that only removes files whose hashes still match
   (preserving any host edits made after installation).

### Planned Adapters

| Adapter ID | Target directory | File format |
|------------|-----------------|-------------|
| `claude-code` | `.claude/skills/atm-*/` | SKILL.md |
| `copilot` | `.github/copilot-instructions.md`, `.github/instructions/atm-*.instructions.md`, `.github/prompts/atm-*.prompt.md` | Markdown |
| `cursor` | `.cursor/rules/skills/atm-*/` | Markdown |
| `gemini` | `.gemini/commands/atm-*.toml` | TOML |
| `codex` | `integrations/codex-skills/atm-*/` | SKILL.md |

### Minimum Entry Skill Set

Every adapter must expose at least these seven ATM entry skills:

- `atm-next` — governed next action routing
- `atm-orient` — start a guidance session with a goal
- `atm-create` — create a new governed work item
- `atm-lock` — acquire a scope lock
- `atm-evidence` — record execution evidence
- `atm-upgrade-scan` — scan for upgrade signals
- `atm-handoff` — produce a handoff summary

All skills wrap ATM CLI commands. They must not introduce a parallel governance
model.

### CLI Surface

The integration adapter lifecycle is exposed through `atm integration`:

```
atm integration list [--json]          # list available and installed adapters
atm integration add <id>               # install an adapter
atm integration verify <id>            # check for drift
atm integration remove <id>            # clean uninstall (hash-guarded)
```

`atm init --integration <id>` installs an adapter in one step during project
bootstrapping.

---

## Non-goals

These items are explicitly out of scope to preserve ATM's atomic governance
identity:

- No parallel task model, registry, or approval workflow introduced by adapters.
- No `presets` / `extensions.yml` ecosystem (the Plugin SDK already handles this).
- No sequential slash-command-first workflow (ATM routes through atom DAGs).
- No Markdown-as-interface philosophy (ATM authority comes from schema + registry
  + evidence).
- No `packages/core` changes for agent-specific logic.

## Implementation Status

M4 is delivered as the first concrete Integration Adapter Layer contract. `packages/integrations-core` now defines `IntegrationAdapter`, `InstallManifest`, SHA-256 helpers, and a Codex skills adapter factory. `schemas/integrations/install-manifest.schema.json` validates the hash-locked manifest, and `scripts/validate-integration-adapter.ts` exercises install, verify, drift detection, and hash-guarded uninstall for the existing Codex skill surface.

See [CHANGELOG.md](../CHANGELOG.md) for delivered milestone entries.

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [HOST_GOVERNANCE_INTEGRATION.md](./HOST_GOVERNANCE_INTEGRATION.md)
- [ADAPTER_GUIDE.md](./ADAPTER_GUIDE.md)
- [schemas/charter/charter-invariants.schema.json](../schemas/charter/charter-invariants.schema.json)
- [templates/root-drop/.atm/charter/atomic-charter.template.md](../templates/root-drop/.atm/charter/atomic-charter.template.md)
