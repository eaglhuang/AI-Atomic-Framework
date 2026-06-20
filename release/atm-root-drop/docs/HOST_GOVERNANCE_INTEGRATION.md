# Integration with Host Governance

ATM is designed as a neutral operating layer. By default it guides agent behavior,
records evidence, and lets `atm doctor` detect missing governance signals after the
fact. For normal adopter repositories it does not make commits impossible by
itself.

Terminology boundary: ATM is the product, framework, CLI, and governance workflow. AI-Atomic-Framework is only this repository name; do not call ATM AAF.

Host repositories can choose stronger enforcement without changing ATM core
contracts. The special exception is the ATM framework repository itself: when a
change touches framework critical non-doc source surfaces, framework-development
mode requires editor hooks, Git hooks, and commit-range gates.

## Framework Charter Authority

ATM ships a framework-level authority document — the **AtomicCharter** — that applies to every repository that adopts ATM. The charter resides at `.atm/charter/atomic-charter.md` with a machine-readable companion at `.atm/charter/charter-invariants.json`.

The charter establishes a non-negotiable authority hierarchy:

```
AtomicCharter (framework layer)     ← highest authority
    ↑ conflicts require waiver flow
host project rules / profiles       ← secondary
    ↑ extends
single-agent / single-user overlays ← lowest
```

**What this means in practice:**

- Host project rules and profiles may extend or restrict ATM behavior within the bounds defined by the charter invariants.
- A host rule that contradicts a charter invariant must go through a governed `charterWaiver` proposal — it cannot silently override the invariant.
- `atm doctor` runs a `charter-integrity` check on every call. A missing charter file or hash mismatch produces `ATM_DOCTOR_CHARTER_MISSING` or `ATM_DOCTOR_CHARTER_HASH_MISMATCH` and routes `atm next` to charter repair before any other governed action.
- `atm upgrade --propose` compares the proposal against invariants before allowing promotion. Proposals that violate an invariant and lack a `charterWaiver` field are blocked with `ATM_CHARTER_INVARIANT_GATE`.

The charter is installed automatically by `atm init --adopt default`. The five seed invariants are:

| ID | Title | Enforcement |
|----|-------|-------------|
| INV-ATM-001 | No second registry | gate |
| INV-ATM-002 | Lock before edit | doctor |
| INV-ATM-003 | Schema-validated promotion only | gate |
| INV-ATM-004 | No competing highest authority | doctor |
| INV-ATM-005 | Host rule amendments require waiver flow | waiver-required |

See `schemas/charter/charter-invariants.schema.json` for the authoritative data contract.

## How ATM Enforces Governance

ATM's native governance comes from three places.

- Default guards in `.atm/runtime/default-guards.json` define the expected run
  envelope after bootstrap. The default bundle currently ships
  `preserve-host-workflow`, `lock-before-edit`, `evidence-after-change`, and
  `protect-context-budget`.
- Deterministic guards and verification commands enforce specific checks without
  relying on prompt discipline alone. One small built-in example is
  `node atm.mjs guard encoding --files <comma-separated-paths> --json`.
- `node atm.mjs doctor --json` inspects current repository state and reports
  layout health, runtime gaps, and Git commits that are not covered by ATM
  evidence.

This is intentionally portable enforcement. ATM defines the contract, captures
evidence, and exposes shared trust signals, but it does not replace the host's
own commit, merge, or deployment gates.

## The Cooperation Gap

ATM assumes an agent will enter through the official path, usually `AGENTS.md`,
the repository README, or `node atm.mjs next --json`. That works well for
cooperative agents that read repository instructions before editing files.

The gap appears when an agent edits files or creates commits directly through the
filesystem or Git without first asking ATM for the next governed action. ATM core
does not try to block raw file mutation or Git commands by itself. Instead, it
makes bypass detectable and gives the host project shared signals it can use in
hooks, CI, and review policy.

## Enforcement Layers

Use these layers in increasing strength:

| Layer | Purpose | Provided by |
| --- | --- | --- |
| `AGENTS.md` / README entry | Make `node atm.mjs next --json` the first instruction an agent sees. | ATM core (rendered by `atm init`) |
| `atm doctor` | Detect missing runtime state, layout drift, and Git commits without matching ATM evidence. | ATM core (always available) |
| Editor integration hooks | Wake the agent before response/tool use and block framework critical edits without a claim. | **Mandatory for ATM framework-development; optional for adopters** |
| Git hooks | Block local commits, run pre-commit checks, and record staged-tree evidence for the new commit. | **Mandatory for ATM framework-development; host opt-in for adopters** ([example](../examples/git-hooks-enforcement/README.md)) |
| CI / commit-range gate | Catch `--no-verify`, amend, or external-agent commits that bypass local hooks. | **Mandatory for ATM framework-development; host opt-in for adopters** |
| Branch protection | Require the CI gate before merging protected branches. | Host policy |
| Review policy | Ask reviewers to inspect the ATM evidence paths linked by `doctor`, handoff summaries, and reports. | Host policy |

### What ATM core does NOT do for adopter repositories

For normal adopter repositories, the framework intentionally does not:

- require Git hooks on `atm init` or any other bootstrap command;
- write to CI configuration files (`.github/workflows/`, `.gitlab-ci.yml`, etc.);
- assume a specific CI provider, host platform, or branch-protection model;
- enforce that hooks are present.

These are deliberate adopter boundaries. Hooks, CI integration, and branch
protection remain opt-in host recipes for non-framework projects. In the ATM
framework repository, `node atm.mjs doctor --json` fails when mandatory editor
or Git hooks are missing or drifted.

## Git Evidence Boundary

`atm doctor` checks Git evidence only when both conditions are true:

- the repository is a real Git worktree;
- ATM has been adopted in that repository.

The check passes without blocking when a repository is not Git-backed, has not
adopted ATM yet, or has no commits. In those cases the `git-head-evidence` check
reports a non-blocking status such as `not-git`, `not-adopted`, or `no-commits`.

## Historical Ledger Restore Boundary

Historical ledger restore is a narrow repair path for re-committing an already
closed ATM task packet when the packet was lost, removed from history, or
restored from an archival source. It is not a general `.atm/history/**`
allow-list and it is not a replacement for normal active-task delivery.

A standard restore commit uses the governed wrapper:

```shell
node atm.mjs git commit --actor <current-operator> --task <closed-task> --message "atm: restore <closed-task> historical ledger packet" --json
```

The staged packet is accepted only when all staged files belong to one closed
task and match the restore shape:

- `.atm/history/tasks/<task>.json`
- `.atm/history/evidence/<task>.json`
- `.atm/history/evidence/<task>.closure-packet.json`
- `.atm/history/task-events/<task>/*.json`

The task ledger must already be `status: "done"`. The task, evidence, closure
packet, and task-event metadata must all point to the same task id. Any staged
source file, runtime file, unrelated task ledger, incomplete packet, or
non-`done` task returns to the normal active-task claim/session checks instead
of using the restore exception.

Keep provenance and attribution separate. Historical fields inside the restored
packet, such as old owners, claim ids, session ids, task-event actors, or
closure actors, remain archival provenance and should not be rewritten to the
current operator. Git author identity and ATM commit trailers must represent the
current operator honestly; do not impersonate the historical actor to satisfy a
restore.

`--no-verify` remains an emergency-only bypass for maintainer-controlled
recovery. It should not be documented or used as the standard historical ledger
restore flow.

Protected override audit (`TASK-MAO-0037`):

- Every governed bypass writes append-only events under `.atm/history/protected-override-audit/`.
- `node atm.mjs emergency audit --json` lists authorization, success, and failure outcomes with `failureCode` when an authorized operation still fails.
- `node atm.mjs git commit --no-verify` requires `--emergency-approval <leaseId>` with `backend.gitHookBypass` permission; authorization records `outcome: authorized`, completion records `succeeded` or `failed`.
- Pre-push safe mode (`ATM_FRAMEWORK_PUSH_GUARD_SAFE_MODE`) also records an audit event when actor and reason metadata are present.
- Human approval authorizes an operation; ATM records whether the operation actually completed.

When the check applies, evidence can match the latest commit in either of these
ways:

- `details.git.commitSha` equals the latest commit SHA;
- `details.git.treeSha` equals the governed tree identity and
  `details.git.parentCommitShas` equals the latest commit parents.

The tree-based form exists because local pre-commit hooks cannot know the future
commit SHA before Git creates it.

When the latest applicable commit has no matching evidence, `atm doctor` returns
`ok: false` and emits `ATM_DOCTOR_GIT_EVIDENCE_MISSING`.

## Detecting Governance Bypass

When a host wants to know whether work may have bypassed ATM, use
`node atm.mjs doctor --json` and inspect the response instead of parsing `.atm/`
files directly.

These response fields are the main governance signals:

- `evidence.checks[]` includes named checks such as `governance-layout-v2` and
  `git-head-evidence`.
- `evidence.currentTaskId` shows whether ATM believes a task is active.
- `evidence.lockOwner` and `evidence.activeLockPath` show whether a live scope
  lock exists and who holds it.
- `evidence.lastEvidenceAt` is `null` when no evidence has been recorded in the
  adopted repository yet.
- `evidence.migrationNeeded` tells the host to repair the governance layout
  before treating the result as authoritative.
- `evidence.recommendedAction` provides a safe next command for humans, wrappers,
  or automation.

In practice, these patterns are the most useful:

- `governance-layout-v2.ok === false` means ATM is not ready yet or needs
  migration.
- `lastEvidenceAt === null` means the repository has no recorded ATM evidence yet.
- `currentTaskId !== null` with `lockOwner === null` means task metadata exists
  without a live lock.
- `ATM_DOCTOR_GIT_EVIDENCE_MISSING` means the current applicable HEAD is not
  covered by ATM evidence.

`atm registry-diff` can still help investigate a specific atom's version drift.
For adopter-managed map members, it resolves `members[].versionLineage` when no
standalone atom entry exists, and returns `ATM_DIFF_LINEAGE_MISSING` if that
lineage contract has not been backfilled yet. Hosts should resolve that condition
through `node atm.mjs registry lineage backfill`: use `--dry-run` for the
deterministic patch preview, then `--apply` only with passing equivalence,
propagation, review advisory, and approved human review evidence.

## Recommended Host Setup

1. Bootstrap ATM in the repository.
2. Keep the single-entry ATM route visible in `AGENTS.md` and the root README.
3. Optionally install the hook recipe from
   [examples/git-hooks-enforcement/README.md](../examples/git-hooks-enforcement/README.md).
4. Add a CI step:

```bash
node atm.mjs doctor --json
```

5. Treat `ATM_DOCTOR_GIT_EVIDENCE_MISSING` as a blocking signal.
6. Keep host-specific escalation policy in the host repository, not in ATM core.

The shipped hook example delegates to `node atm.mjs hook pre-commit --json`.
That command does not run `doctor` before writing evidence; it checks the staged
diff, task audit, encoding/mojibake, framework-development blockers, and required
validators, then writes staged-tree evidence to
`.atm/history/evidence/git-head.json`.

## Adapter-Level Enforcement

Hooks and CI are host-side gates. A stronger option is to implement a custom
`ProjectAdapter`, governance bundle, or related Plugin SDK surface that requires
lock presence, evidence persistence, or policy acknowledgements before
host-specific mutation steps are allowed to proceed.

This is the strongest option when the host already routes important writes
through ATM-aware tooling. It is also the most expensive, because the host must
maintain that adapter boundary over time.

See [ADAPTER_GUIDE.md](./ADAPTER_GUIDE.md) for the stable adapter contract and
[ARCHITECTURE.md](./ARCHITECTURE.md) for the layer boundary that keeps host
policy out of core semantics.

## Closeback operator integration

Host wrappers and editor adaptors should route closeout through the governed
operator lane, not through raw Git or backend repair commands.

| Concern | Host integration point |
|---|---|
| Pre-close visibility | Call `taskflow pre-close` before any close `--write`; surface `scopeTrackedDirtyFiles`, `unexpectedStagedTasks`, and `staleEvidence` to the operator. |
| Foreign staged bundles | When parallel agents share one worktree, expose `--defer-foreign-staged` on delivery and close wrappers; never silently unstage another task's governance bundle. |
| Close verification | After close, call `task-view` and check `closeCompletionChecklist.partialClose === false`. |
| Historical delivery | When delivery predates governance, route to `evidence historical-batch` plus per-task `taskflow close --historical-batch`; one batch envelope does not replace per-task close. |
| Banned shortcuts | Do not document `tasks repair-closure` as close; do not hand-edit `.atm/history/**`; do not use bare `git commit` for ledger mutations. |

Full runbook: `docs/ATM_NEW_USER_WORKFLOW.md` (Closeback operator runbook).
Git defer and snapshot contract: `docs/governance/git-governance-contract.md`
(Foreign staged restore protocol). Batch envelope rules:
`docs/governance/historical-batch-evidence.md`.

## Related Documentation

- [ADAPTER_GUIDE.md](./ADAPTER_GUIDE.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [SELF_HOSTING_ALPHA.md](./SELF_HOSTING_ALPHA.md)
- [examples/git-hooks-enforcement/README.md](../examples/git-hooks-enforcement/README.md)
- [examples/agent-handoff-flow/README.md](../examples/agent-handoff-flow/README.md)
