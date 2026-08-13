# Plan 3.0–4.0 Objective Evidence Matrix

This matrix is a fail-closed certification input. The verdict is recomputed from
the referenced machine-readable reports; status labels are not trusted by
themselves.

| plan | exact row proof | verdict | explicit non-claim |
|---|---|---|---|
| 3.0 | `plan-3-0-objective-replay.json`: 17/17 verified | proven | Objective replay does not replace backlog or release controls. |
| 3.1 | `plan-3-1-objective-replay.json`: 23/23 verified | proven | Runner publication alone is not product approval. |
| 3.2 | `plan-3-2-objective-replay.json`: 29/29 verified | proven | Component receipts alone do not close the plan. |
| 4.0 | `plan-4-foundation-replay.json`: 17/17 plus independent objective verdict | proven | Foundation replay alone is not final certification. |

Shared controls are proven by the backlog census plus explicit deferred-waiver
register, the remote-reachable release closeback, and the independent certificate.
The waiver carries deferred bugs forward by digest and does not call them fixed.

Legacy authority is retired reversibly. Any missing, stale, contradictory,
unreachable, unresolved, or unknown input immediately restores it and changes
the canonical certificate to `not-certified`.
