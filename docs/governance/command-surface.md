# ATM Command Surface

> **Audience**: ATM contributors and agent-integration authors.
> **Owner**: `atom-cli-command-specs`
> **Status**: minimal drift-guard seed for the public top-level command surface.

This document lists the public top-level commands that must remain visible in
ATM documentation. The source of truth for command names, visibility, summaries,
options, and examples remains `packages/cli/src/commands/command-specs.ts` and
the per-command specs under `packages/cli/src/commands/command-specs/`.

This seed intentionally keeps the top-level command list narrow. Richer help
facets such as examples, required-flag sets, related commands, common
mistakes, playbook notes, maintainer notes, and deprecated guidance belong to
the command-spec help surface returned by `node atm.mjs <command> --help`.

## Drift Guard

Run this guard when a command is added, hidden, removed, or renamed:

```bash
node --strip-types scripts/validate-docs-command-drift.ts
```

The guard checks that:

- docs and schema text do not mention a top-level `atm <command>` that is absent
  from the command spec registry;
- docs and schema text do not mention a top-level command that is hidden from
  public help;
- every public command returned by `listCommandSpecs()` has an entry in this
  document.

## Public Top-Level Commands

| Command | Purpose |
| --- | --- |
| `node atm.mjs actor` | Manage actor identity records and git identity alignment. |
| `node atm.mjs agent-pack` | Install, remove, diff, or list ATM agent packs. |
| `node atm.mjs atm-chart` | Render or verify the ATMChart rule summary. |
| `node atm.mjs atom-ref` | Generate and validate readable atom or map references. |
| `node atm.mjs atomize` | Inspect and improve atomization coverage. |
| `node atm.mjs baseline` | Manage redteam baselines for framework work. |
| `node atm.mjs batch` | Inspect, repair, resume, or checkpoint a batch run. |
| `node atm.mjs bootstrap` | Create or refresh the default bootstrap pack. |
| `node atm.mjs broker` | Broker daemon and steward surfaces for governed writes. |
| `node atm.mjs budget` | Evaluate context budget policy for governed work. |
| `node atm.mjs cache` | Manage guide and one-file runtime caches. |
| `node atm.mjs candidates` | Rank legacy source candidates and emit evidence. |
| `node atm.mjs create` | Create and register an atom. |
| `node atm.mjs create-map` | Create and register an atomic map. |
| `node atm.mjs doctor` | Inspect repository readiness and trust signals. |
| `node atm.mjs emergency` | Manage human-approved emergency maintenance leases. |
| `node atm.mjs evidence` | Add or verify task evidence. |
| `node atm.mjs experience` | Extract reviewable learning artifacts from evidence. |
| `node atm.mjs explain` | Explain guidance blocks and missing evidence. |
| `node atm.mjs framework-mode` | Inspect framework-development hard gates. |
| `node atm.mjs git` | Prepare git identity, commit, and verify git governance. |
| `node atm.mjs git-hooks` | Install or verify ATM-managed Git hooks. |
| `node atm.mjs guard` | Run governance guards. |
| `node atm.mjs guide` | Show guided workflows and classify free-text goals. |
| `node atm.mjs handoff` | Write continuation summaries. |
| `node atm.mjs hook` | Run ATM-managed repository hook gates. |
| `node atm.mjs identity` | Manage default actor identity and session hints. |
| `node atm.mjs init` | Adopt ATM in a repository. |
| `node atm.mjs integration` | Manage agent integration adapters and hooks. |
| `node atm.mjs internal-release` | Build and sync the framework runner to internal repos. |
| `node atm.mjs lane` | Inspect, lazily mint, heartbeat, sweep, or explicitly adopt an ATM lane session. |
| `node atm.mjs lock` | Check, acquire, or release a governed scope lock. |
| `node atm.mjs migrate` | Plan, apply, or verify schema migration codemods. |
| `node atm.mjs next` | Route work into the official ATM channel. |
| `node atm.mjs orient` | Inspect a repository and emit an orientation report. |
| `node atm.mjs police` | Run the police family gate. |
| `node atm.mjs quickfix` | Manage lightweight quickfix runtime locks. |
| `node atm.mjs registry` | Backfill registry lineage from verified evidence. |
| `node atm.mjs registry-diff` | Generate registry version hash diff reports. |
| `node atm.mjs replacement-lane` | Advance replacement rollout lanes. |
| `node atm.mjs review` | Inspect or decide upgrade proposal review packets. |
| `node atm.mjs review-advisory` | Generate non-blocking semantic advisory findings. |
| `node atm.mjs rollback` | Plan or apply rollback for registry targets. |
| `node atm.mjs route` | Route governed actions through ATM policy. |
| `node atm.mjs self-host-alpha` | Verify self-hosting alpha criteria. |
| `node atm.mjs spec` | Validate atomic specs or supported reports. |
| `node atm.mjs start` | Start a guidance session for a concrete goal. |
| `node atm.mjs status` | Inspect ATM repository status. |
| `node atm.mjs task-view` | Read-only task dashboard for status, blockers, and close checklist. |
| `node atm.mjs taskflow` | Governed dual-repo task open, pre-close, and closeback. |
| `node atm.mjs tasks` | Manage task import, queues, claims, evidence gates, and closure. |
| `node atm.mjs team` | Plan or start scoped team agents. |
| `node atm.mjs telemetry` | Manage opt-in CLI telemetry. |
| `node atm.mjs test` | Run atom and map test surfaces. |
| `node atm.mjs upgrade` | Propose or plan safe upgrades. |
| `node atm.mjs validate` | Run repository or framework validation checks. |
| `node atm.mjs verify` | Run verification checks for hashes, neutrality, or agents. |
| `node atm.mjs welcome` | Print first-touch onboarding guidance. |

## Planned Git Boundary Lane

The current public `git` surface governs identity, governed commit, and git
governance checks. `TASK-GIT-0001` reserves a future pre-push admission lane
under the same top-level command family:

- planned subcommand: `node atm.mjs git admit`
- purpose: compare local and remote branch deltas from a merge base before push
- contract: [git-boundary-admission-contract.md](./git-boundary-admission-contract.md)

This planned lane must remain a `git` subcommand, not a new top-level ATM
command.

Related operator policy surfaces:

- `node atm.mjs integration hooks verify git-pre-push`
- `node atm.mjs git recover-push-fail`
- `node atm.mjs git commit --no-verify --emergency-approval <leaseId> --reason "<why>"`

Policy note:

- local hooks are detectable but bypassable;
- protected branch / server-side enforcement remains a deployment policy layer,
  not a local MVP guarantee.

## Lane Session Maintenance

The public `lane` surface owns the local lane-session runtime envelope used by
agents and tools that need stable per-session governance identity.

- `node atm.mjs lane status --json` resolves the current lane, lazily minting a
  new lane when no usable `ATM_LANE_SESSION_ID` exists.
- `node atm.mjs lane heartbeat <lane-id> --actor <actor> --json` records an
  explicit heartbeat, extends the lane TTL, and writes a lane-session event.
- `node atm.mjs lane sweep --json` reports TTL-expired lane sessions without
  changing runtime state.
- `node atm.mjs lane sweep --write --json` expires only sweepable TTL-expired
  lane sessions and records sweep events as command-backed evidence.
- `node atm.mjs lane adopt <lane-id> --actor <actor> --json` transfers an
  adoptable lane to another actor and records the adoption event.

Sweeps are intentionally report-only unless `--write` is present. This keeps
lane cleanup auditable and prevents maintenance commands from silently
destroying active coordination state.
