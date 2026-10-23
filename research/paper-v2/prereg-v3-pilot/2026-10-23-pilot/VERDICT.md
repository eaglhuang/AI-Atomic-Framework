# Pilot verdict: valid observations; B task blocked

Owner approved this reduced pilot on 2026-10-23 at 17:46 Asia/Taipei: one runnable task pair, k=2, zero stagger, one repetition, A once then B once. This generation is **pilot only**, not formal evidence. No formal runs started. No win claim.

CLI 0.1.22 and immutable kit `cli-0.1.22-v13-367` match VALID r13. All four task sessions exited 0, none hit the 20-minute cap, and none signaled quota exhaustion. Both preflight probes passed on their first attempts.

| Arm | Pilot validity | Pinned scorer status | Lost edits | Silent lost edits | Conflicts | Kit-errors | Gold tests passed/failed: 13820; 11141 |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| A | VALID | ok | 1 | 1 | 0 | 0 | 23/2; 24/1 |
| B | VALID | blocked | 1 | 0 | 2 | 0 | 25/0; 24/1 |

Two task arm runs completed: 2 VALID, 0 INVALID. Observed kit-error arm rate: 0/2. B's blocked result makes the paired scorer status `blocked` and evaluator exit 3; this is a recorded task outcome, not a kit crash. Test failures and model rejections remain reported outcomes. All missing measurements stay null.

B recorded six steward proposals: one accepted, five rejected (three `patch-malformed`, one `overlapping-write-queued`, one `cross-session-overlap`); scorer retryCount=1. All six records match the model-session receipts, including message codes. The accepted loader write matches the attributed commit and remains byte-identical in the final tree. See `receipt-audit.json`.

The scorer's B lostEditCount=1 concerns B2's intended `tests/migrations/test_loader.py` hunk. B2 explicitly reported that the test update was not submitted; every steward proposal targets `django/db/migrations/loader.py`. Preserve the pinned count unchanged, but do not interpret this item as evidence that an accepted write was overwritten. A's counted loss is A1's intended loader hunk. These are the pinned scorer's edit counts, not independent estimates of successful-task loss rates.

| Session | Wall seconds | Input tokens | Output tokens | Reported total_tokens | Observed tool calls |
| --- | ---: | ---: | ---: | --- | ---: |
| A1 | 20.762 | 123632 | 1113 | null | 6 |
| A2 | 32.653 | 232929 | 1958 | null | 8 |
| B1 | 26.136 | 144824 | 1554 | null | 6 |
| B2 | 35.977 | 246817 | 2642 | null | 10 |

Task totals: 748202 input, 7267 output, 683264 cached input (already included in input), reported total_tokens=null; 30 observed calls. Arm wall times A=33.419s, B=39.045s; successful pipeline stages total 313.487s including preflight/setup/evaluation/seal. The two real preflight probes add 99532 input, 624 output and 5 calls. `pilot-metrics.json` separates task and probe measurements.

One initial offline preflight stopped before model calls because a nested Unix socket path was too long; its log is retained. A fresh shorter clone-local scratch path passed the unchanged preflight. Scratch cleanup was confined to new pilot scratch. No kit files, published CLI version, earlier generations, paper body, or workflows were changed.

`formal-runs-plan-v2.md` proposes G=1, main/held-out=1/0, A/B, k=2, zero stagger, r=3 with fixed A/B, B/A, A/B order; model seeds are null because unsupported. Its pilot-based expectation is 8.85 minutes including preflight, 2,344,138 input and 22,425 output (derived planning proxy 2,366,563; reported total remains null). The r=1 alternative is 5.22 minutes and proxy 855,625. Both estimates assume the same free login with no paid fallback (incremental paid model spend estimate USD 0; API-equivalent valuation null). No independent held-out task group is available in this kit. These are proposals awaiting user sign-off and a frozen condition, not executed formal schedules. A third arm or k=4 needs a separately approved new kit generation.
