# 9. Real-Agent Track (prereg-v3): with vs. without ATM — BLOCKED

> Status: **BLOCKED / GATED TODO — design summary + placeholders.** The #311 smoke uses paid model runs and was deliberately **not** run for this draft set (2026-10-30); every table below stays a placeholder until 文一 approves that run. Pre-registration is a draft, **not frozen** (`P/prereg-v3-draft/2026-10-15/prereg-v3-draft.md`, `P/EVIDENCE_INDEX.md` §43; feasibility §44). Only pilot/diagnostic material exists; nothing here is a formal result.

## 9.1 Design as drafted

Real coding agents work concurrently on SWE-style task groups sharing one base. Arms (v14 kit `cli-0.1.22-v14-367`, dataset `2026-10-24-six-pairs`; `P/prereg-v3-smoke/2026-10-24-v14-three-arm/CONDITION.md`): **A** shared direct Git; **B** ATM socket with Unix-user ownership; **B-wt** private worktree/branch per slot. Run order A, B, B-wt; k = 2 agents, R_max = 2. Main group g05 = `django__django-13820` + `django__django-11141` at base `98ad3278…`; g04/g06 held out.

## 9.2 What exists (not citable as results)

- 2026-10-23 pilot (`P/prereg-v3-pilot/2026-10-23-pilot/VERDICT.md`, kit v13): pilot only. A VALID, lost 1; B VALID, blocked, lost 1 — B's lost item is an **unsubmitted test hunk, not an overwrite**; B produced 6 proposals, 1 accepted, 5 rejected.
- 398 replay (`P/prereg-v3-replay/2026-10-23-398/VERDICT.md`): diagnostic; the old kit rejected malformed patches locally before the CLI anchored them — a kit defect, not an ATM core defect.
- v14 three-arm smoke: only `CONDITION.md` and `run-smoke.sh` exist; no sealed output (#311 rerun pending).
- `formal-runs-plan-v2` proposes r = 3 repetitions, awaiting sign-off; a third arm requires a new kit.

## 9.3 Placeholders

| Placeholder | Awaits |
|---|---|
| T-v3-smoke (A/B/B-wt validity) | v14 three-arm smoke executed and sealed (#311 rerun; owner approval for paid model runs) |
| T-v3-main (lost edits, overwrites, task resolution, cost per arm) | prereg-v3 frozen + formal-runs-plan-v2 signed off + runs sealed |
| T-v3-held (g04/g06) | after main sealed |
| Metric definition of "lost edit" | paper-wide definition adopted (06a §6.1 preamble: acknowledged-applied but absent from final bytes; unsubmitted hunks are not lost); the prereg-v3 scorer must be aligned before freeze |
