# Contributing to ATM Core

> Audience: external contributors proposing changes to ATM Core surfaces
> (`packages/core/**`, `packages/cli/**`, schemas, runner artifacts).
> Internal contributors should follow the MAO governed work flow first.

## 0. Before you start

ATM Core changes flow through the Runner Broker model (see
`docs/ai_atomic_framework/multi-agent-orchestration/atm-core-runner-broker-design.md`).
External contributions enter that model via this pipeline rather than committing
directly. The pipeline keeps adopter installations bit-identical to upstream by
funneling all core changes through a single steward-rebuild lane.

## 1. Required local setup

```bash
git clone <fork-url>
cd AI-Atomic-Framework
npm install
node atm.mjs --help                              # frozen runner sanity check
npm run validate:cli                             # 41 commands healthy
npm run validate:schemas                         # all schemas valid
```

If you intend to publish a runner artifact change as part of your contribution,
also run:

```bash
node --strip-types scripts/validate-runner-refs.ts
node --strip-types scripts/validate-runner-submit-pipeline.ts
node --strip-types scripts/validate-runner-broker-failures.ts
```

## 2. Pipeline overview

```
contributor fork ──► PR with patch envelope ──► CI gate (validate-external-core-pipeline) ──► steward review ──► steward rebuild ──► upstream merge
```

External contributions never write to `release/**` directly. The steward
rebuild lane re-runs `npm run build` from your source change and re-publishes
runner artifacts under a fresh in-dev/HEAD bump.

## 3. Patch envelope contract for external contributors

Every PR that touches `packages/core/**` or `packages/cli/**` must carry an
ATM-core-annotated patch envelope (see TASK-MAO-0015):

- `scopeClass`: `atm-core` for core source; `external-host` only if your change
  is host-side glue that does not affect the runner artifact.
- `publishIntent`: `patch-only` for non-publishing improvements;
  `in-dev-bump` if your change implies a new in-dev HEAD; `version-publish`
  for proposed version cuts (rare for external contributors).
- `declaredSourceCommit`: the upstream commit your patch was rebased onto.

The submit pipeline (TASK-MAO-0016) admits or rejects your patch deterministically.

## 4. CI gate

PRs run `scripts/validate-external-core-pipeline.ts` in CI. The validator
confirms:

1. The patch envelope is well-formed (no malformed annotation rejections).
2. The declared source commit matches the current in-dev/HEAD on the upstream
   fork (no stale-base rejections at merge time).
3. The patch does not directly modify `release/**` (steward-only zone).
4. The contributor signed off (`Signed-off-by:` line per upstream policy).

A failed gate posts a deterministic comment explaining which check failed and
the required remediation.

## 5. Steward review

Steward review is a human-in-the-loop step that:

- Verifies the patch fits the broker model (no atom write/write conflict with
  in-flight upstream work).
- Confirms the test plan covers the runner-affecting surface change.
- Issues a freeze on the affected refs if a parallel internal contribution is
  in flight; the patch is rebased on the post-freeze head before merge.

## 6. Merge and publish

After steward approval the patch is squash-merged. The steward then runs the
rebuild lane in a clean target repo and publishes a fresh in-dev/HEAD via the
runner-ref store (TASK-MAO-0014). Closure of any upstream tracking issue
records the new runner version in its closure packet (TASK-MAO-0018).

## 7. Failure-mode reference

See `docs/reports/runner-broker-failure-coverage.md` for the deterministic
failure-mode coverage matrix. If your PR is rejected, look up the verdict code
in that document for the canonical remediation.
