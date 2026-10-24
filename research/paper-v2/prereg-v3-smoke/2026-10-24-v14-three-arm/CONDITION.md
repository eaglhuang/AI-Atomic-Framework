# v14 single-group three-arm smoke condition

Recorded before model calls, following owner authorization 2026-10-23 18:13 Asia/Taipei. No formal runs.

Kit cli-0.1.22-v14-367, public CLI 0.1.22, Codex 0.163.0, gpt-6-luna, medium effort, free ChatGPT login only. No paid fallback. Dataset generation 2026-10-24-six-pairs; main g05 only: django__django-13820 + django__django-11141 at common base 98ad327864aed8df245fd19ea9d2743279e11643. Held-out g04/g06 receive no model sessions.

Exactly one repetition, arms A then B then B-wt, k=2, stagger=0 seconds, slots use the listed task order. Model seed=null (unsupported); fixed arm order is a smoke operational order, not randomized formal inference. Both task sessions start from the same base. B-wt integrates submitted branch heads in slots 1 then 2; R_max=2 fresh resolution rounds per conflicting second merge, twenty minutes per task/resolver session. Fixed prompt bytes are in the hashed launcher; append original issues, conflict paths and group public tests only. No manual resolution.

Run the committed run-smoke.sh once after the kit checksum and real containment/socket regressions pass. All prerequisites are model-free and recorded separately. Six task sessions and zero to two resolver sessions; no model preflight retries or quota retry. Stop the driver on any invalid arm or quota stop. Every kit-error => INVALID; missing observations remain null. Archive unsuccessful attempts; do not overwrite the kit or evidence.

Per-session wall, reported token fields and unique tool-item counts; resolver, snapshot, merge and oracle accounting; original and submitted end snapshots; final oracle; conflicts/rejections/resubmissions and accepted-commit audit are retained. Scorer definitions and limitations are in the kit README. No win claim.

Pre-run planning estimate from the earlier two-arm pilot: about 5–20 minutes for this small smoke, approximately 1.13 million input+output token proxy for six sessions, up to about 1.51 million with two similar resolver sessions; these are extrapolations, not observed totals. A/B each have a twenty-minute task-phase cap; B-wt has twenty minutes plus at most forty resolver minutes. Setup/evaluation add measured overhead. Current free-login incremental API spend is $0; API-equivalent price is null. Formal plan v3 will replace these estimates with this smoke's observations.

Exact command from repository root:

```bash
PYTHONDONTWRITEBYTECODE=1 bash research/paper-v2/prereg-v3-smoke/2026-10-24-v14-three-arm/run-smoke.sh
```

Long driver execution is detached with its driver log under this generation; inspect it actively. No formal matrix is launched.
