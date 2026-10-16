# Status: INVALID (kit-error) — do not cite

Run real-20261016T221257, gpt-6-luna, reasoning_effort=medium, Codex 0.163.0, boundary unix-user.
- Arm B session 1: atm-write -> steward socket `connect EPERM` (kit-error: inner `--sandbox workspace-write` without network access blocks the Unix socket in unix-user mode). No steward writes were recorded.
- Arm B: `atm-write` was not on the session PATH (`type: atm-write: not found`).
- All 4 sessions: evaluate.py reported evidence_missing even though BEGIN/END_INTENDED_PATCH markers are present (capture_intended_patch searches raw stdout.jsonl for a literal newline; in JSONL it is escaped).
All metrics are null; FAIL_TO_PASS/PASS_TO_PASS were not evaluated. Exploratory smoke; no win claim.
