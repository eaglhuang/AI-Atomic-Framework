# Captain handoff — 2026-08-13, claude-008-captain

Written while blocked. Everything below is reproducible from the repository; no
step depends on this document being trusted.

## Blocker

`.git/index.lock` is orphaned: zero bytes, created 2026-08-13T07:34 local, still
present nearly four hours later with `HEAD` unchanged at
`c486a50413c7ea3865adf218d69bb9550431b607`, branch commit queue free, and no
stdin pathspec helper detected. Every governed staging, commit, close and push
path is stopped behind it.

The governed recovery route exists and ATM names it exactly:

```
node atm.mjs emergency approve --permission backend.gitIndexLockRecovery \
  --actor claude-008-captain --task ATM-GOV-0353 \
  --allowed-flag --force-index-lock-recovery \
  --approval-text "<human approval sentence>" \
  --reason "<why emergency backend is required>" --json
```

That command was refused twice by the Claude Code permission classifier, not by
ATM. It was not worked around, and the lock file was not removed by hand.

`tasks import --force` is blocked by the same permission surface, which is why
the ATM-GOV-0354 planning card carries an ACC-5 amendment that the ledger copy
does not yet reflect.

## Landed

`c486a5041 perf(next): memoize planning root resolution per process`
(ATM-GOV-0353) — one commit ahead of `origin/main`, not pushed.

The frozen runner was published from that commit through the governed
`runner-publication-takeover` receipt; the runner-sync steward queue is empty.

`node atm.mjs next --json` CLI logic went from 3650ms to 68ms against a 500ms
budget, and `validate-next-warm-run-latency` — a **full** profile member, and
therefore a hard gate on the closeout runbook — reports `ok` with
`p50=1573ms p95=2151ms`.

## Uncommitted, all mine, all verified green

| Path | Card | State |
| --- | --- | --- |
| `scripts/lib/validator-contract-subject.ts` | ATM-GOV-0354 | new |
| `scripts/validate-branch-commit-queue.ts` | ATM-GOV-0354 | modified |
| `scripts/validate-bridge-minor.ts` | ATM-GOV-0354 | modified |
| `tests/cli/validator-contract-subject.test.ts` | ATM-GOV-0354 | new |
| `docs/multi-agent-compatibility-matrix.md` | none | regenerated artifact |
| `docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-08-13-001.json` | none | new |
| `docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-08-13-002.json` | none | new |

Plus seven runner publication members under `release/**` and
`packages/cli/dist/**` produced by the sealed build of `c486a5041`.

## Resume sequence

Both claims are live but their leases are 30 minutes; expect to re-mint. An
expired lane session reports `ATM_TASK_CLAIM_OWNER_MISMATCH` naming the same
actor on both sides — that is lane TTL, not ownership, and the recovery is
`lane status --actor` then `tasks repair-claim --write --reason` then
`next --claim` through the **frozen** runner.

```
LANE=$(node atm.mjs lane status --actor claude-008-captain --json | ...)

# 1. publication commit for ATM-GOV-0353 (release surfaces are already in its
#    direction lock via tasks scope add; --auto-stage will not pick them up
#    because they are not declared deliverables, so stage them explicitly)
git add -- release packages/cli/dist
ATM_LANE_SESSION_ID=$LANE node atm.mjs git commit --task ATM-GOV-0353 \
  --actor claude-008-captain --message "chore(release): publish frozen runner from c486a5041" --json

# 2. close ATM-GOV-0353 (evidence for all four declared validators is already
#    recorded; --historical-delivery is required because delivery landed first)
ATM_LANE_SESSION_ID=$LANE node atm.mjs taskflow close --task ATM-GOV-0353 \
  --actor claude-008-captain --historical-delivery c486a50413c7ea3865adf218d69bb9550431b607 --write --json

# 3. ATM-GOV-0354: commit, evidence, close
# 4. re-run npm run validate:standard on a quiet tree
# 5. push AI-Atomic-Framework, then 3KLife (master, 53 commits ahead of origin/master)
```

## Standard profile: 12 reds, fully triaged

These are pre-existing on `origin/main`. `git diff --name-only 554092cd1 c486a5041`
covers only ATM-GOV-0353, and two representative reds were reproduced with the
new planning-root cache disabled, so that change is excluded as a cause.

Repaired: `validate-multi-agent-confidence` (stale generated matrix),
`validate-bridge-minor` (ordering asserted against a renamed CI step),
`validate-branch-commit-queue` (two of three anchors were path and quote-style
defects).

Left red deliberately, tracked in `ATM-BUG-2026-08-13-001` and `-002`:

- `validate-branch-commit-queue` still reports `branch queue stale self-heal must
  not clean cross-actor locks`. The guard is genuinely absent from
  `git-governance/implementation/branch-commit-window.ts`. It was not restored
  and the anchor was not weakened, because ATM-GOV-0265 relaxed this area to
  break a stale-lock deadlock and the removal may be deliberate. Read that
  history before deciding.
- `validate-broker-registry`, `-brokered-write`, `-broker-steward`: the fixtures
  assert that an atom ID/CID overlap alone yields `blocked-cid-conflict`, but
  `decision.ts` now gates that on `hasSharedWriteSurface`, and the fixture
  intents target disjoint files. The observed `parallel-safe` follows the
  current documented rule and matches INV-ATM-008. Rewrite the fixtures to test
  both sides of the refinement; do not remove the gate.
- Four hook and direction-lock validators, the sharpest being a fixture that
  expects cross-file consistency to block a commit while it now allows it. This
  overlaps the surface that recently narrowed that check and needs its owner.
- `validate-task-ledger-governance`: its repair-closure fixture spawns
  `atm.dev.mjs git commit` and the child exits 1 with stdout and stderr captured
  as `null`. A scratch-repo probe of the same command shape returns
  `ATM_WRITE_TICKET_MISSING`, so the fixture most likely provisions a claim
  without minting a work-admission ticket. The suppressed child output is a
  second, independent defect: a validator whose own log cannot explain its
  failure is not command-backed evidence.
- `validate-skew-matrix` at 192686ms against a 180000ms budget is the
  timing-margin flake the runbook already owns as WP-03A.

## Gate items that are green

Backlog census 393 items, `unclassified=0`, `releaseBlockingNow=0`, deferred
waiver register 133. Objective replays: Plan 3.0 17/17, Plan 3.1 23/23, Plan 3.2
29/29 verified; Plan 4 successor wave consumed; `unresolvedObjectiveRows=0`.
Runner-sync queue empty. Charter current verdict `proven`.
