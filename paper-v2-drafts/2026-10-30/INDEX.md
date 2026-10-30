# ATM Paper 2.0 — English section drafts (2026-10-30)

Local drafts only; not committed. Repo: `AI-Atomic-Framework` main `ccea864` (read-only). `P/` = `research/paper-v2/`. `DRAFT-zh` = `P/working-docs/2026-10-14/paper/ATM_PAPER_V2_DRAFT_zh.md`. Rules: only sealed/committed evidence; no pilot/superseded/invalid numbers as results; every number cites a path. Word counts: see bottom.

| File | Section | Status | Main evidence | Open questions |
|---|---|---|---|---|
| 00-abstract.md | Abstract | PARTIAL | DRAFT-zh §摘要/§1.5 | result sentences await G2/G4 |
| 01-introduction.md | Intro, motivation, scope/threat model, RQs, contributions, v1.1 defects | DRAFTED | DRAFT-zh §1; related-work r2 | RQ2 wording aligned to HIST-v2 arms (DRAFT-zh still lists OCC + Git separately); EOF scope text updated |
| 02-v1-commitments-and-historical-diagnosis.md | v1 commitments, version anchors, motivation M1, probe P1 | DRAFTED | DRAFT-zh §2; R1 probe + T6 audit | v0.9↔v0.1 mapping (G12) |
| 03-protocol-and-trust-model.md | Protocol, concurrency + trust model | DRAFTED (spec) | DRAFT-zh §3; PR #297 | receipt fields vs schema (G14) |
| 04-composition-contract-and-implementation.md | Composition contract, system design §4.11 | DRAFTED; proof sketch (conservative), oracle pending | DRAFT-zh §4; EVIDENCE_INDEX §9 | G5; G6 residual |
| 05-hist-v2-methods.md | HIST-v2 methods as designed | DRAFTED (methods) | benchmark-prereg/2026-10-14-hist-v2.0; classifier v8; classify-v8 §34 | v2.1 amendment (§5.11) pending commit |
| 06a-results-r1-r6-write-safety.md | r1–r6 write safety, F6 fix, EOF bug | DRAFTED | R1–R6 generations; hist-main + hist-main-v2 GENERATION.md | — |
| 06b-results-hist-v1.1-historical.md | HIST v1.1 + limitations | DRAFTED (historical) | hist-main-v2 analysis/TABLES.md, GENERATION.md; `rescore-v1.1/` | R12 bounded (G8) |
| 06c-hist-v2-results-TODO.md | HIST-v2 results | **BLOCKED** | none valid | G1, G2 |
| 07-limitations-and-threats.md | Limitations / threats | DRAFTED | inline | — |
| 08-related-work.md | Related work | DRAFTED | related-work/2026-10-15-r2; arxiv.org | G12 residual |
| 09-prereg-v3-real-agents-TODO.md | Real-agent track | **BLOCKED** | prereg-v3 draft/pilot/replay (diagnostic) | G4, G9 |
| 10-conclusion-TODO.md | Conclusion | PARTIAL/BLOCKED | — | G2, G4, G15 |
| GAPS.md | Gap list | — | — | — |
| prereg-hist-v2.1-amendment.md | HIST-v2 amendment v2.1 (OSF transparent changes) | DRAFT, pending commit | benchmark-prereg v2.0; EVIDENCE_INDEX §28–§41 | **[SIGN-OFF]** commit |
| pilot-r2-rootcause.md | Read-only root cause of pilot-r2 `inconsistent:ack` | DONE | pilot-r2 §41; harness v3 source | harness v4 build |
| rescore-v1.1/ | Bounded re-score of v1.1 R12 | DONE | hist-main-v2 `semantic/out/*.json` | raw logs not sealed |
| repo-doc-fixes.md | Fixes needed in repo docs (not applied) | LIST | — | governance commit |

## Inconsistencies found in the evidence

1. `P/EVIDENCE_INDEX.md` has two `## 6.` headings; prereg-v3 rows are appended after "## 6. 不在 repo 的參照" without their own header; `P/README.md` does not list the prereg-v3 entries. — *Status 2026-10-30:* → repo-doc fix (`repo-doc-fixes.md` R1–R2); not edited here.
2. DRAFT-zh (2026-10-14) is stale: §5 says classifier v8 has no sealed `items.jsonl` and smoke not executed, but classify-v8 is sealed (§34, 4,095 items) and smokes/pilots later ran (then SUPERSEDED/INVALID, §35/§36); §36 and the diagnosis say "no pilot-r2", superseded by §41. — *Status 2026-10-30:* → repo-doc fix (R3); drafts cite §34–§41 directly.
3. DRAFT-zh §1.2 says files without trailing newline must be rejected, but `b1fd9d22` (component e) supports `\ No newline at end of file`. — *Status 2026-10-30:* **Resolved in drafts:** 01 §1, 04 §4.2/§4.4 (EOF bullet), 06a §6.1.7 say the marker is supported since `b1fd9d22`. DRAFT-zh fix → R4.
4. Issue/PR labels: the repo ties #291 to the five write plants (issue) and #311 to prereg-v3 smoke reporting; the HIST-v2 artefacts landed as PRs #293/#294/#297/#298/#299. Labels "#290/#292" for coordinator/harness/smoke do not match. — *Status 2026-10-30:* **Corrected:** the labels are real *issue* numbers (GitHub API, 2026-10-30): #290 batch coordinator → PR #297; #291 harness v2 incl. negative controls → PR #298; #292 smoke runbook → PR #299 (and approval tokens `issue-292-author-approved-*`); #311 prereg-v3 smoke (open). Drafts now cite issue → PR (05 §5.6, §5.11).
5. `5692474f` on the same E4 replay differs by round: r2 4 failed/6 lost; r3 8/12; r4 1,580 completed, 5/75, 6 lost; r5 1,515, 6/75, 6 lost. — *Status 2026-10-30:* **Resolved:** 06a L80 reports per round; 06b old-pin paragraph now states it is the single HIST v1.1 old-pin generation, not a pool.
6. Live-temp counts: index 60/60 (r5, r6) vs DRAFT-zh Table R5 30/30 (per arm) — aggregation, must be stated. — *Status 2026-10-30:* **Resolved:** 06a Table R5 states 60/60 = 3 placements × 10 runs × 2 arms (30/30 per arm), `R5/.../faults/main.summary.json` `O2-live-writer-temp`.
7. HIST v1.1 R8: DRAFT-zh "4,480 harness relocation (85.8%)" vs sealed `TABLES.md` 4,468 relocation + 12 other. — *Status 2026-10-30:* **Resolved:** 06b Table R8 uses 4,468 + 12 other.
8. Component labels drift: r4 record calls the apply queue "(d3)" and "not implemented"; DRAFT-zh §4.11 uses (d3) = orphan cleanup, (d4) = queue. — *Status 2026-10-30:* **Resolved:** 04 §4.11 fixes one labelling and gives the r4 citation form.
9. HIST-v2 pilot-r2: 110.327 s submit gap vs 506.531 ms arrival delay → unexplained harness/scheduler defect. — *Status 2026-10-30:* **Explained** (`pilot-r2-rootcause.md`); fix pre-declared in v2.1 A8–A9; harness v4 not built.
10. prereg-v3 pilot "lost = 1" in arm B counts an unsubmitted hunk → metric semantics ambiguous. — *Status 2026-10-30:* **Resolved for this paper:** "lost" defined in 06a preamble; 07, 09 updated; prereg-v3 scorer alignment open (G9).
11. Claim Plane references (arXiv:2607.21909, 2608.00947) cited in DRAFT-zh but absent from the related-work folder. — *Status 2026-10-30:* **Verified** on arxiv.org (both exist; author Maxim Nikolaev; titles/dates in 08 §8.1); added to 08. DRAFT-zh 〔待核對原文〕 → R5.

Word counts (wc -w, 2026-10-30 update): 00 405 · 01 1,285 · 02 1,188 · 03 828 · 04 1,776 · 05 1,128 · 06a 1,652 · 06b 1,402 · 06c 297 · 07 697 · 08 801 · 09 328 · GAPS 522 · prereg 1,539 · pilot 948 · repo 408.
