# Repo documentation fixes needed (NOT applied)

Repo `AI-Atomic-Framework` main `ccea864`; `P/` = `research/paper-v2/`. These are governance/record files: nothing below was edited (needs 文一's approval and a commit). Found while drafting 2026-10-30.

| # | File | Problem | Proposed fix |
|---|---|---|---|
| R1 | `P/EVIDENCE_INDEX.md` | Two `## 6.` headings; the prereg-v3 rows (§43–§44 material) are appended after "## 6. 不在 repo 的參照" without a heading of their own | Renumber the second `## 6.`; give the prereg-v3 rows their own `##` section |
| R2 | `P/README.md` | Does not list the prereg-v3 entries (draft, feasibility, kits, pilot, replay, smoke) | Add rows pointing to `P/prereg-v3-*` and the EVIDENCE_INDEX sections |
| R3 | `P/working-docs/2026-10-14/paper/ATM_PAPER_V2_DRAFT_zh.md` §5 | Says classifier v8 has no sealed `items.jsonl` and smoke not executed; classify-v8 is sealed (§34, 4,095 items), smoke/pilot ran and are SUPERSEDED/INVALID (§35/§36), pilot-r2 exists (§41) | Add a dated "stale as of" banner or a superseding note; do not edit the frozen text if treated as a record |
| R4 | same, §1.2 | "Unsupported syntax must be rejected" read as covering missing trailing newline; `b1fd9d22` component (e) supports `\ No newline at end of file` (DRAFT-zh L497) | Note that the EOF marker is supported since `b1fd9d22` |
| R5 | same, refs (L991, L1165, L1470–1471) | Claim Plane refs marked 〔待核對原文〕 | Verified 2026-10-30 on arxiv.org: 2607.21909v1 (Maxim Nikolaev, "Claim Plane: Enforceable Change Intents and Dynamic Scope for Parallel Coding Agents", 2026-07-24, cs.SE); 2608.00947v1 (Nikolaev, "Claim Plane: Reliability Gains and the Limits of Selective Concurrency for Parallel Coding Agents: A 30-Pair, Three-Seed Confirmatory Study of Deterministic Pre-Write Admission", 2026-08-02). Remove the marker; use full titles |
| R6 | `P/EVIDENCE_INDEX.md` §36 header, pilot-diagnosis docs | Say "no pilot-r2" — true when written, superseded by §41 | Add forward pointer to §41 |
| R7 | Docs that describe issue #291 as "the five write plants" | Issue #291 is "HIST-v2: harness v2（原子 textual_merge_file、統一期限、多 session driver、combined_success、負控制）"; the five plants are one part of it | Describe #291 as the harness-v2 issue (implemented by PR #298) |
| R8 | `P/benchmark-prereg/` | Needs the v2.1 amendment directory (`<date>-hist-v2.1/` with amendment + SHA256SUMS + verify.sh) and an EVIDENCE_INDEX row | Commit `prereg-hist-v2.1-amendment.md` from this draft set **[SIGN-OFF]** |
| R9 | Harness v3 source (`textual.py:38`, `file_lock_arm.py:18`, `steward.py:29`) | Per-writer stop vs item-level T_stop (prereg §3.2) | Harness v4 per `pilot-r2-rootcause.md` §3 (new versioned dir; v3 untouched) |
