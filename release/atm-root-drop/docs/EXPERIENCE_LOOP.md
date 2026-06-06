# ATM Experience Loop Implementation Plan

> Status: Draft implementation plan
> Owner: ATM Core
> Created: 2026-05-14
> Companion docs: [ARCHITECTURE.md](./ARCHITECTURE.md), [LIFECYCLE.md](./LIFECYCLE.md), [HOST_GOVERNANCE_INTEGRATION.md](./HOST_GOVERNANCE_INTEGRATION.md), [ECOSYSTEM_POSITIONING.md](./ECOSYSTEM_POSITIONING.md)

## 0. Summary

ATM atoms do more than execute governed behavior: they can use task experience as evidence to identify repeated mistakes and propose reviewable corrections to future atomic behavior.

The first implementation target is intentionally small:

- extract skill candidates from task evidence;
- propose amendments to existing skills when repeated corrective evidence appears;
- emit memory nudges through an adapter boundary;
- route all generated candidates through existing advisory and human review surfaces.

## 1. Problem Statement

Current ATM flow:

```text
WorkItem -> ScopeLock -> Atom execution -> Evidence -> ContextSummary -> AdapterReport
```

The flow stops at the report. Repeated evidence does not flow back into the atom catalog, skill surfaces, or host memory stores. That creates four practical gaps:

- repeated failure patterns stay buried in task history;
- skill creation remains fully manual;
- skill correction has no standard proposal envelope;
- host memory updates rely on agent discipline instead of framework signals.

The experience loop closes that gap without making ATM a runtime agent.

## 2. Design Principles

1. **Plugin first**: implementation lives in `packages/plugin-experience-loop`; core contracts only receive optional additive fields.
2. **No runtime lock-in**: the plugin does not depend on any specific agent CLI, conversation store, or model provider.
3. **Review before promotion**: every generated candidate remains a proposal until existing review advisory and human review gates accept it.
4. **Host memory boundary**: ATM may emit `MemoryNudge` records, but a host adapter decides whether and where to persist them.
5. **Failure is advisory**: experience-loop hooks must degrade to warnings so ordinary governed tasks can still finish.
6. **Neutral defaults**: generated text must avoid downstream-only terms and host-specific policy unless the host adapter supplies them as review context.

## 3. Proposed Atoms

| Planned atom | Action | Lifecycle mode | Purpose |
| --- | --- | --- | --- |
| `ATM-EXP-0001` | `experience.extract-skill` | `birth` | Convert completed task evidence into a reviewable `SkillCandidate`. |
| `ATM-EXP-0002` | `experience.amend-skill` | `evolution` | Propose a bounded update to an existing skill when repeated corrective evidence appears. |
| `ATM-EXP-0003` | `experience.memory-nudge` | `birth` | Emit a host-routed suggestion to persist recurring knowledge. |

These atoms are planned in this document first. Registry promotion should happen only after the plugin, fixtures, review route, and validator are stable enough to avoid placeholder registry entries.

## 4. Candidate Schemas

### 4.1 SkillCandidate

```jsonc
{
  "schemaVersion": "atm.skillCandidate.v0.1",
  "id": "skill-candidate-<hash>",
  "sourceTaskId": "TASK-0001",
  "proposedName": "recurring-error-handling",
  "proposedDescription": "USE FOR: ... DO NOT USE FOR: ...",
  "proposedApplyTo": ["packages/**"],
  "proposedSteps": ["Read evidence", "Check affected contract", "Run validator"],
  "confidence": 0.72,
  "patternTags": ["missing-adapter", "validation-gap"],
  "evidenceRefs": ["evidence.validation.1"],
  "lifecycleMode": "birth",
  "status": "candidate",
  "review": {
    "required": true,
    "route": ["plugin-review-advisory", "plugin-human-review"]
  }
}
```

### 4.2 SkillAmendmentProposal

```jsonc
{
  "schemaVersion": "atm.skillAmendmentProposal.v0.1",
  "id": "skill-amendment-<hash>",
  "targetSkillId": "skill.existing-id",
  "rationale": "Repeated corrective evidence crossed the configured threshold.",
  "proposedChangeSummary": "Add an adapter-boundary preflight step.",
  "confidence": 0.68,
  "evidenceRefs": ["evidence.review.2"],
  "lifecycleMode": "evolution",
  "status": "candidate"
}
```

### 4.3 MemoryNudge

```jsonc
{
  "schemaVersion": "atm.memoryNudge.v0.1",
  "id": "memory-nudge-<hash>",
  "scope": "repo",
  "suggestedKey": "adapter-boundary.md",
  "suggestedContent": "Adapter contracts should own host-specific persistence decisions.",
  "rationale": "Pattern adapter-boundary appeared in 3 evidence records.",
  "evidenceRefs": ["evidence.validation.1"]
}
```

## 5. Package Plan

```text
packages/plugin-experience-loop/
├── package.json
├── README.md
├── src/
│   └── index.ts
└── schemas/
    ├── memory-nudge.schema.json
    ├── skill-amendment.schema.json
    └── skill-candidate.schema.json
```

The `@ai-atomic-framework/plugin-experience-loop` package exports pure drafting functions plus `AtomBehavior` wrappers. It does not promote candidates, mutate registries, execute skills, or write host memory by itself.

## 6. Lifecycle Integration

| Hook point | Experience-loop behavior | Blocking policy |
| --- | --- | --- |
| `post-evidence` | Detect and tag recurring evidence patterns. | Warning only. |
| `post-task` | Generate skill candidates and amendment proposals. | Warning only unless host policy opts in. |
| `pre-handoff` | Attach candidate paths or summaries to context summaries. | Warning only. |
| `pre-finalize` | Check whether required human review decisions exist for promoted candidates. | Host-configurable. |

## 7. Host Adapter Boundary

The Plugin SDK gains an optional `MemoryStoreAdapter` surface:

```ts
interface MemoryStoreAdapter {
  read(scope: "repo" | "user" | "session", key: string): Promise<string | null> | string | null;
  write(scope: "repo" | "user" | "session", key: string, content: string): Promise<void> | void;
  list(scope: "repo" | "user" | "session"): Promise<readonly string[]> | readonly string[];
  search?(query: string): Promise<readonly MemorySearchResult[]> | readonly MemorySearchResult[];
}
```

The adapter is optional. Hosts without a memory store can still use skill extraction and amendment proposals.

## 8. Milestones

### Milestone 1: Planning and Skeleton

Target: establish the neutral contract and a package that typechecks.

- [x] Add this implementation plan with explicit milestones and checklist.
- [x] Add `plugin-experience-loop` package skeleton.
- [x] Add SDK memory adapter interface.
- [x] Add fixture-driven validator.
- [ ] Add registry entries for `ATM-EXP-0001` through `ATM-EXP-0003` after atom workbench files exist.

### Milestone 2: CLI Extraction Flow

Target: make the loop invokable through ATM without requiring a host runtime.

- [x] Add `atm experience extract` command.
- [x] Support JSON input fixtures and optional JSON output path.
- [x] Include command help in global help snapshots.
- [x] Route generated candidates into review advisory output.
- [x] Persist generated candidates into a governed proposal queue.

### Milestone 3: Review Integration

Target: connect generated learning artifacts to existing governance.

- [x] Attach review advisory findings to `SkillCandidate` records.
- [x] Add a human-review queue-compatible proposal snapshot for experience candidates.
- [ ] Promote accepted skill candidates into atom workbench entries.
- [ ] Record rejected candidates and rejection reasons as evidence.

### Milestone 4: Host Memory Integration

Target: let hosts opt into memory persistence while keeping ATM neutral.

- [ ] Provide a local file-backed `MemoryStoreAdapter` reference implementation.
- [ ] Add cross-session search as an optional adapter capability.
- [ ] Add `atm experience nudge` once the adapter path is stable.
- [ ] Document host policies for accepting, editing, or rejecting nudges.

### Milestone 5: Registry Promotion

Target: formalize the atoms after the loop proves stable.

- [ ] Create atom workbench specs and tests for `ATM-EXP-0001`.
- [ ] Create atom workbench specs and tests for `ATM-EXP-0002`.
- [ ] Create atom workbench specs and tests for `ATM-EXP-0003`.
- [ ] Update registry provenance auditing to recognize `experience-extracted`.
- [ ] Add experience-loop coverage to compatibility documentation.

## 9. Implementation Checklist

### Contracts

- [x] Add optional `patternTags` to `EvidenceRecord`.
- [x] Add optional `recurringSignal` to `EvidenceRecord`.
- [x] Add `MemoryScope`, `MemorySearchResult`, and `MemoryStoreAdapter` to the Plugin SDK.
- [x] Add a formal JSON schema validation pass for all three candidate documents.

### Plugin

- [x] Export `extractSkillCandidate`.
- [x] Export `createSkillAmendmentProposal`.
- [x] Export `createMemoryNudges`.
- [x] Provide default thresholds.
- [x] Export `experience.extract-skill`, `experience.amend-skill`, and `experience.memory-nudge` as `AtomBehavior` implementations.
- [x] Export a queue-compatible experience proposal snapshot.
- [ ] Split detector and drafter internals into separate modules once the API stabilizes.

### CLI

- [x] Add `experience` command registration.
- [x] Add `experience extract` help surface.
- [x] Add fixture-backed validator coverage.
- [x] Add `experience extract --advisory-out` for review advisory output.
- [x] Add `experience extract --queue` for governed human-review queue persistence.
- [ ] Add `experience amend` command.
- [ ] Add `experience nudge` command.

### Documentation

- [x] Add architecture reference.
- [x] Add lifecycle reference.
- [x] Add host governance memory boundary.
- [ ] Add end-to-end example once review queue integration lands.

### Governance

- [x] Review advisory integration.
- [x] Human review queue integration.
- [ ] Registry promotion.
- [ ] Provenance audit support.

## 10. Non-Goals

The experience loop intentionally does not include:

- user personality modeling;
- model training or reinforcement learning environments;
- a required SQLite or full-text search dependency;
- messaging gateways;
- automatic promotion without human review.

## 11. Acceptance Criteria

- `npm run typecheck` passes.
- `npm run validate:experience-loop` passes.
- `node atm.mjs experience extract --input fixtures/experience-loop/task-evidence.json --json` emits a `SkillCandidate`.
- `node atm.mjs experience extract --input fixtures/experience-loop/task-evidence.json --queue <path> --advisory-out <path> --json` emits reviewable governance artifacts.
- `node atm.mjs experience --help --json` appears in the global command list.
- The new plugin remains publishable under the package skeleton validator.
