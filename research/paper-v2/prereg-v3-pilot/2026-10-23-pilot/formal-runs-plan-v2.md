# Formal-runs plan v2 — proposed freeze, awaiting user sign-off

Date: 2026-10-23, Asia/Taipei. Issue #367. No formal runs have started.
Pilot evidence: research/paper-v2/prereg-v3-pilot/2026-10-23-pilot/.
This proposal supersedes the blocked v1 plan; v1 is preserved as formal-runs-plan.v1.md outside the repository. User must approve and the formal condition must be recorded/frozen before execution. The existing draft remains unfrozen.

## Proposed frozen values

| Parameter | Proposed value |
| --- | --- |
| G and split | G=1 runnable group; main=1, held-out=0. It is the pilot-exposed pair; there is no independent held-out sample in this kit. |
| Tasks / base | django__django-13820 + django__django-11141; base 98ad327864aed8df245fd19ea9d2743279e11643 |
| Arms | A shared worktree without ATM; B shared worktree with ATM steward; 2 arms only |
| CLI / kit | Published CLI 0.1.22; unchanged cli-0.1.22-v13-367, manifest sha256:bb675b8a043df576bd3e021dab15c57609ba774e89b4fd905f1448f5ffbbdefa |
| Agent | Codex 0.163.0, gpt-6-luna, medium effort, existing free ChatGPT login; no paid fallback |
| Boundary / overlap | unix-user; overlapCondition none |
| k / stagger | k={2}; stagger=0 seconds (actual spawn skew retained) |
| Repetitions | 3, fresh state/worktrees each time: 6 arm runs and 12 task sessions |
| Model seeds | null: pinned launcher exposes no model seed. Do not invent deterministic model seeds. |
| Fixed order | Repeat 1: A then B; repeat 2: B then A; repeat 3: A then B. Session 1=13820, session 2=11141. Fixed order, not a claim of randomization. |
| Session wall cap | 1,200 seconds, using the same external timeout wrapper as the pilot; timeout recorded as censored/incomplete, never fabricated success |
| Session token / tool caps | null: kit has no enforceable limits for these. Proposed values explicitly retain this limitation rather than claiming a new control. |
| Planning token allowance | 3,000,000 derived input+output units including one preflight; review after each completed arm and stop scheduling further arms on excess. This is a planning threshold, not an intra-session hard cap. |
| Quota / invalidity | Stop on quota or failed prerequisites; no paid fallback. Any kit-error makes the affected arm INVALID and the paired result INVALID; missing measurements null. |
| Stage guards | Preflight 29 min; each repeat setup 14 min, A 25 min, B 25 min, evaluate 14 min, seal 5 min. Stop on a failed stage. |

The one-group, zero-held-out design can describe repeated behavior on this pair. It cannot estimate generalization across task groups or claim held-out confirmation. Expanding G or introducing an independent held-out group requires validated runnable inputs; none are supplied by the pinned kit's backups (marked runnable=false). Do not manufacture a second group by relabeling a repetition.

## Pilot measurements and estimates

The owner-approved pilot ran exactly A once and B once at k=2, with 4 task sessions. Both arm runs are VALID observations (0 INVALID, 0 kit-errors / 2 task arm runs). Scorer statuses are A=ok, B=blocked; evaluator exit=3 is its blocked-result disposition, not a kit crash.

| Session | Wall seconds | Input tokens | Output tokens | Reported total_tokens | Tool calls |
| --- | ---: | ---: | ---: | --- | ---: |
| A1 | 20.762 | 123,632 | 1,113 | null | 6 |
| A2 | 32.653 | 232,929 | 1,958 | null | 8 |
| B1 | 26.136 | 144,824 | 1,554 | null | 6 |
| B2 | 35.977 | 246,817 | 2,642 | null | 10 |

Task sessions: 748,202 input + 7,267 output; 683,264 cached input; provider-reported total_tokens=null; 30 observed tool calls. Derived input+output planning proxy=755,469, explicitly not a recovered reported total. Preflight probes add 99,532 input + 624 output and 5 calls (both first attempt). Pilot including probes: 847,734 input + 7,891 output, reported total=null; derived proxy=855,625. Mean task-session wall=28.882 seconds, max=35.977; A arm=33.419 seconds, B arm=39.045 seconds. No session hit its cap; no arm exceeded 30 minutes, so no time-based reduction was triggered.

Successful preflight took 204.744 seconds, setup 16.056, task arms together 72.464, evaluation 19.827, seal 0.395. Successful pipeline stage sum=313.487 seconds (5.225 minutes). One earlier offline preflight stopped on socket-path length before model calls (4.955 seconds); a fresh shorter scratch path passed, without kit changes. That environment preparation is not a task arm or a kit-error rate event.

Estimate formula: one preflight overhead + repetitions × (one setup + A wall + B wall + evaluation + seal). Token/call extrapolation: one preflight + repetitions × the four observed task sessions. These are tiny-sample planning estimates, sensitive to caching, model latency, quota and different trajectories; no precision or general performance claim is implied.

| Budget | Proposed r=3 | Cheaper r=1 |
| --- | ---: | ---: |
| Task arm runs / sessions | 6 / 12 | 2 / 4 |
| Estimated wall incl. preflight | 530.972 seconds = 8.850 min | 313.487 seconds = 5.225 min |
| Input token estimate | 2,344,138 | 847,734 |
| Output token estimate | 22,425 | 7,891 |
| Reported total token estimate | null | null |
| Derived input+output planning proxy | 2,366,563 | 855,625 |
| Cached input estimate (already within input) | 2,135,552 | 769,024 |
| Expected observed calls incl. probes | 95 | 35 |
| Planning proxy allowance | 3,000,000 | 1,000,000 |
| Incremental paid model spend estimate | USD 0, conditional on the same free login; no paid fallback | USD 0, same condition |
| API-equivalent / provider-internal valuation | null | null |
| Sum of stage timeout guards | 278 min (4h38) | 112 min (1h52) |

The stage-guard sum is a bounded execution envelope, not the measured expected duration; failures abort early. It excludes PR/CI/governance time. A practical scheduling reserve is 30 minutes for the expected experiment; session caps allow much slower trajectories within the stage envelope. Free quota availability and refresh time are unknown. No subscription allocation, invoice, or API-equivalent price was measured; USD 0 refers only to proposed incremental paid model calls under the no-paid-fallback policy.

Cheaper alternative: identical group, arms, k, stagger, caps and seed policy; r=1, A then B, only 2 arm runs / 4 task sessions. It reduces replication and cannot measure between-repetition variability. Neither option supplies held-out evidence.

## What a three-arm design needs

Adding B-wt requires a separately user-approved new kit generation: one isolated worktree and branch per session; a fixed merge/integration order; a defined conflict-resolution session/prompt and R_max; wall/token/tool accounting for those sessions; oracle/snapshot/scorer coverage and containment/preflight regressions for the third arm. Freeze that design and its budget before use. The pinned two-arm kit cannot supply B-wt by relabeling A, and this pilot neither implements nor authorizes that extension. k=4 similarly needs an approved launcher/scorer extension. No CLI re-pin or new kit generation was made.

## Commands proposed after sign-off only

No formal command in this section has been executed. Before any future launch, record the signed-off formal condition, acquire the governed scope, create a fresh short clone-local scratch root and cap-wrapper identical to this pilot, set TMPDIR/PREREG_TEMP_ROOT and steward sockets inside it, set the same verified public CLI and Python/model/boundary variables, and verify the immutable manifest. Cleanup remains restricted to that newly created root. For every git/ATM operation retain the user's shorter command limits; never alter workflows or hand-edit .atm state.

Pinned operator sequence (the completed pilot's commands.sh records all exact flags and paths):

```bash
python3 "$KIT/bin/kit_generation.py" --verify
# Once, before task runs:
timeout --signal=TERM --kill-after=15s 1740 env PREFLIGHT_REAL_MODEL=1 bash "$KIT/preflight.sh"
# Fresh PREREG_SMOKE_STATE for each repeat; fixed order A/B, B/A, A/B:
timeout --signal=TERM --kill-after=15s 840 bash "$KIT/setup.sh"
timeout --signal=TERM --kill-after=15s 1500 bash "$KIT/run_arm_a.sh"
timeout --signal=TERM --kill-after=15s 1500 bash "$KIT/run_arm_b.sh"
timeout --signal=TERM --kill-after=15s 840 bash "$KIT/evaluate.sh"
timeout --signal=TERM --kill-after=15s 300 bash "$KIT/seal.sh" --dest "$FRESH_ARCHIVE_DEST"
```

Reverse the two arm commands in repeat 2; retain and interpret scorer exit 3 (blocked) and its raw results. The raw scorer/schema/labels remain unchanged; a separately frozen formal-condition envelope must establish stage and provenance. A missing/failed prerequisite or any kit-error stops scheduling and preserves evidence. A per-arm over-30-minute stop rule remains, although the 25-minute arm-stage guard should stop it first. The external wrapper executes `/usr/bin/timeout --signal=TERM --kill-after=10s 1200 /home/box/.local/node22/bin/codex` for each real exec; it forwards version/help unchanged. node22 npm is selected explicitly whenever npm is needed; none was needed for this pilot.

Pilot headline counts are recorded without alteration: A/B lostEditCount=1/1, silentLostEditCount=1/0; B rejected=5. B's counted loss is an unsubmitted intended test hunk, not an accepted write overwritten. All six journal records match session receipts; the one accepted loader write matches its commit and final file. Per-task gold tests: A 23/2 and 24/1 passed/failed; B 25/0 and 24/1. No win claim; pilot data is not formal evidence.
