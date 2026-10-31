# HIST-v2 pilot-r3: cost measurement, main-run estimate, steward/textual identity threat
Date 2026-10-31 (Asia/Taipei). Notes only; not paper evidence; no prereg change.

## Measured (pilot-r3 attempt 2, harness v4)
- START 08:26:28, EXIT 09:05:43 (+08:00): 2342.5 s wall (monotonic == wall), 1740 cells -> 1.346 s/cell.
- model_calls 0, model_tokens 0 (TIMING line); no Codex "tokens used" lines. Replay of historical hunks: $0 model cost.
- Box Codex cumulative (38 session rollouts in ~/.codex/sessions, final total_tokens): 335,352,786 (> 100M flag).

## Formal sizes (r7 §2/§7 + classify-v8)
- Grid 60 cells/item (2 seeds x 2 orders x 5 intervals x 3 arms); §2 "全部候選都測".
- Main = dev items with a category: 3061 - 773 null = 2288 (A 2153, A' 8, B 126, C 1) -> 137,280 cells.
- Held-out = later-period 194 + project 19 = 213 items (upper bound; nulls drop) -> <= 12,780 cells.
## Estimate (linear in pilot rate, single process)
- Main ~184,800 s ~= 51 h; held-out <= ~4.8 h. Tokens 0, model $0; cost = box time + storage (pilot raw x ~79).
- Frozen params: as r7/v2.1 (v4, CORE_MERGE cb25242433, A9 rule, 2 seeds), plus A13 sharding/checkpoint; 4 shards -> ~13 h if intervals are sleep-bound and don't contend.
- Cheaper option (needs a v2.1 amendment entry BEFORE any main data, since §2 says test all): all A', B, C (135) + seeded stratified 300 of A -> 435 items, 26,100 cells ~= 9.8 h. Non-amending cheaper path is sharding only.

## Identity threat (steward == textual_merge_file in 579/580 groups)
- Both arms compute the candidate with git merge-file on the same three-way, so on A/A'/B/C replay they must coincide; identity is expected, not a bug.
- r7 makes no winner claim and no p-value test (§ "不做勝出宣稱"); hypotheses are safety (zero unsafe accepts, bounded) and progress vs. baselines. Power to separate ATM from file_lock exists (A 251 vs 400, B 220 vs 400). Power to separate ATM from the git baseline on outcomes is ~0 by construction.
- Framing (no prereg change): textual_merge_file is a same-algorithm ceiling; claim = steward reaches git-merge-file progress while adding ack/deadline/atomic-replace guarantees. Where they can differ: late-write-after-timeout / ack semantics, order-dependent sets, 3-4 proposal extension, compose window (atm arm, exploratory A5), crash/receipt-loss (§7 not covered). Report the 1/580 discordant group in detail. Any new differentiating condition = new prereg version, not this one.
