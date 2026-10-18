# STATUS: INVALID — do not cite
Run on main 0e78130b (#344 merged), unix-user boundary, gpt-6-luna, reasoning effort medium. Sessions started 2026-10-17T12:58+08 (UTC+8). Kit status=blocked (Arm B). Label: smoke / exploratory, not results. No win claim.

This file was added after seal. It is not in SHA256SUMS. Neither are `DISCLOSURE.md`, `post-seal/`, or `EVIDENCE_INDEX_ROW.md`. The sealed archive is unchanged byte for byte, and `sha256sum -c SHA256SUMS` passes.

Basis: 2026-10-18 daily review, issue #345, comment 6244084054.

Reasons for INVALID:
1. **Missing data recorded as 0.** `results.json` records `tokens.total_tokens = 0` for all four sessions. The `turn.completed.usage` object from Codex 0.163.0 has no `total_tokens` field; it only has input, cached_input, output and reasoning_output. A field with no evidence must be `null`, not 0.
2. **Steward rejections counted as conflicts.** Arm B `conflictCount = 3`. All three steward rejections are `patch-context-mismatch` on malformed proposals, with `declaredBaseHash == currentFileHash`: there was no base drift and there were no git errors. These are rejections, not conflicts.
3. **Undisclosed deviation in preflight.** Preflight passed only on the 3rd attempt. The RUNBOOK has no retry rule, so the retry is a deviation that was not disclosed at run time. See `DISCLOSURE.md` and `post-seal/`.
4. **Session PATH order.** Every session's `launch-env.txt` has `PATH=/home/box/.local/bin:<PREREG_ARM_BIN>:<kit/bin>:<venv/bin>:...`. `/home/box/.local/bin` comes before the arm's bin directory, so a same-named binary there would shadow the kit and arm shims.
