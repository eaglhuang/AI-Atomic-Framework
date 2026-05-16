# Integration with Host Governance

ATM is designed as a neutral operating layer. By default it guides agent behavior,
records evidence, and lets `atm doctor` detect missing governance signals after the
fact. It does not make commits impossible by itself.

Host repositories can choose stronger enforcement without changing ATM core contracts.
This document explains what ATM enforces natively, where the cooperation boundary
is, and how a host can add harder gates on top.

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

| Layer | Purpose |
| --- | --- |
| `AGENTS.md` / README entry | Make `node atm.mjs next --json` the first instruction an agent sees. |
| `atm doctor` | Detect missing runtime state, layout drift, and Git commits without matching ATM evidence. |
| Git hooks | Block local commits when the previous HEAD already bypassed ATM, and record staged-tree evidence for the new commit. |
| CI | Run the same `atm doctor --json` gate on pushed commits. |
| Branch protection | Require the CI gate before merging protected branches. |
| Review policy | Ask reviewers to inspect the ATM evidence paths linked by `doctor`, handoff summaries, and reports. |

## Git Evidence Boundary

`atm doctor` checks Git evidence only when both conditions are true:

- the repository is a real Git worktree;
- ATM has been adopted in that repository.

The check passes without blocking when a repository is not Git-backed, has not
adopted ATM yet, or has no commits. In those cases the `git-head-evidence` check
reports a non-blocking status such as `not-git`, `not-adopted`, or `no-commits`.

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

`atm registry-diff` can still help investigate a specific atom's version drift,
but it is an atom-to-atom comparison tool, not a repository-wide bypass audit by
itself.

## Recommended Host Setup

1. Bootstrap ATM in the repository.
2. Keep the single-entry ATM route visible in `AGENTS.md` and the root README.
3. Install the opt-in example from
   [examples/git-hooks-enforcement/README.md](../examples/git-hooks-enforcement/README.md).
4. Add a CI step:

```bash
node atm.mjs doctor --json
```

5. Treat `ATM_DOCTOR_GIT_EVIDENCE_MISSING` as a blocking signal.
6. Keep host-specific escalation policy in the host repository, not in ATM core.

The shipped hook example follows the same pattern: the `pre-commit` hook runs
`atm doctor`, writes staged-tree evidence to
`.atm/history/evidence/git-head.json`, stages that evidence file, and then the
`post-commit` hook checks the new HEAD immediately.

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

## Related Documentation

- [ADAPTER_GUIDE.md](./ADAPTER_GUIDE.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [SELF_HOSTING_ALPHA.md](./SELF_HOSTING_ALPHA.md)
- [examples/git-hooks-enforcement/README.md](../examples/git-hooks-enforcement/README.md)
- [examples/agent-handoff-flow/README.md](../examples/agent-handoff-flow/README.md)
