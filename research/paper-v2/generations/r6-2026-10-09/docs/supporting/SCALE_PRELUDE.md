# SCALE_PRELUDE — 8 agents × 200／1000 trials（real ATM，single- vs multi-process）

| 欄位 | 內容 |
|------|------|
| 日期 | 2026-10-06（Asia/Taipei），matrix 19:33:49–19:38:22（約 4.5 分鐘，15 runs） |
| Harness | atm-bench 0.3.0-latency ＋ Phase 1/2 的改動（`run-small` = single-process，`run-mp` = 8 個 OS process、共用 registry／CAS） |
| ATM | `atm_backend=real`：`@ai-atomic-framework/core@0.1.2` |
| Node | v24.21.0（nvm），box only（8 vCPU、16 GB；跑的時候可用 ~3 GB） |
| 共同設定 | `seed=42`, 8 agents, tick 50 ms, hold 20–60 ms, jitter 15 ms（S4 除外） |
| 原始資料 | `runs/sc-<S>-<arm>-r<N>`；彙整 `runs/scale/summary.{json,md}`（含逐窗 drift 表）；腳本 `runs/scale/{run_matrix.sh,analyze.mjs}`；每個 run 的 stdout 在 `runs/scale/.out-<run_id>` |

| 情境 | 設定 | intents/rep |
|---|---|---|
| **S1** | 200 trials、hot 0.4、overlap med（預設 small scenario 放大），×2 reps | 1451 |
| **S2** | 200 trials、hot **1.0**、overlap high、`--hot-retry loop`（熱檔壓力＋overlay） | 1422 |
| **S3** | **1000 trials**、hot 0.4、overlap med（長時間穩定性；每 run ~50 s） | 7244 |
| **S4** | 200 trials、hot 0.4、med、**unpaced**（tick=0、hold=0、jitter=0：飽和吞吐） | 1451 |

## TL;DR

| 情境 | arm | wall ms | throughput int/s | goodput pass/s | 成功率（pass/intents） | lost（率） | rejects | overhead mean / p95 / max ms | RSS MB（結束） |
|---|---|---|---|---|---|---|---|---|---|
| S1 | control sp（×2） | 10015 | 144.9 | 83.8 | 57.9% | 611.5（42.1%） | 0 | 0.18 / 0.26 / 0.84 | 77 |
| S1 | control 8 procs | 10015 | 144.9 | 83.4 | 57.6% | 616（42.4%） | 0 | 0.42 / 0.54 / 3.9 | 68／worker |
| S1 | **ATM sp（×2）** | 10049（**1.003×**） | 144.4 | **134.7（1.61×）** | **93.3%** | **0** | 97 | 4.84 / 6.50 / 11.4 | 140 |
| S1 | **ATM 8 procs（×2）** | 10100（1.008×） | 143.7 | 132.2（1.58×） | 92.0% | **0** | 116 | 10.13 / 22.9 / 50.5 | 107／worker |
| S2 | control sp | 10026 | 141.8 | 41.1 | 29.0% | 1010（71.0%） | 0 | 0.18 / 0.27 | 77 |
| S2 | **ATM＋hot loop sp** | 11251（**1.12×**） | 126.4 | **126.4（3.1×）** | **100%** | **0** | 0 | 13.3 / 48.9 / 113 | 144 |
| S2 | **ATM＋hot loop 8 procs** | 11641（1.16×） | 122.2 | 122.2（3.0×） | 100% | 0 | 0 | 21.2 / 66.2 / 187 | 108／worker |
| S3 | control sp | 50015 | 144.8 | 84.7 | 58.5% | 3008（41.5%） | 0 | 0.20 / 0.30 / 1.19 | 123 |
| S3 | **ATM sp** | 50054（**1.001×**） | 144.7 | **133.9（1.58×）** | **92.5%** | **0** | 540 | 4.77 / 6.45 / 20.3 | 196 |
| S3 | **ATM 8 procs** | 50058（1.001×） | 144.7 | 132.6（1.57×） | 91.6% | **0** | 605 | 9.35 / 20.9 / 78.4 | 151／worker |
| S4 | control sp | 529 | **2741** | 1889 | 68.9% | 451（31.1%） | 0 | 0.08 / 0.14 | 77 |
| S4 | **ATM sp** | 6152（**11.6×**） | **236** | 224 | 94.8% | 0 | 75 | 4.13 / 5.63 / 14.5 | 134 |
| S4 | **ATM 8 procs** | 5184（9.8×） | **280** | 259 | 92.5% | 0 | 109 | 25.4 / 87.3 / 200 | 120／worker |

**一句話**：放大到 1451–7244 intents，**ATM 在有思考時間（paced）時 wall 幾乎不變（1.001–1.008×），0 lost update、成功率 92–93% vs control 58%，goodput 1.6×**；熱檔全滿＋hot loop 時 wall +12–16%、100% 成功（goodput 3×）。**沒有思考時間（unpaced）時 ATM 是瓶頸：single-process 上限 ~236 intents/s（control 的 1/11.6），8 個 process 也只到 ~280/s**（registry 檔的 CAS 競爭把多核的好處吃掉）。15 個 runs 都沒有 crash、error、timeout，也沒有 registry 殘留。

## 1. 穩定性（drift／不穩定的地方）

- **S3 長跑（50 s、7244 intents）沒有退化**：每 100 trials 一個窗，ATM sp 的 overhead p50 一直在 4.75–5.01 ms、p95 6.11–6.78 ms；8 procs p50 7.5–8.6 ms、p95 19.2–23.6 ms。reject 每窗 43–67 筆，沒有趨勢。registry 檔結束時 251 bytes（`activeIntents: []`）。8 procs 有兩個窗（t400、t800）的 schedule_lag p95 跳到 ~149 ms（其他窗 ~50–90 ms），single-process 在 t800 也有 118 ms —— 看起來是 box 的雜訊／GC，不是累積性的。
- **S2（hot 1.0 ＋ loop）的 `schedule_lag` 會一路長大**：p95 從第一窗的 322 ms → 最後一窗 1215 ms（sp），8 procs 402 → 1672 ms。意思是熱檔全滿時，序列化後的服務速率**低於** agent 的到達速率，agent 越落越後面；跑越久 wall 的倍率會越大（200 trials 是 1.12×／1.16×）。這是「hot loop overlay 不穩定（unbounded backlog）」的前兆，在更大的 trial 數下要特別看。
- **S4 unpaced 8 procs**：CAS conflict 20202 次／2793 txns，80% 的 transaction 至少重試一次，單一 transaction 最多重試 **72 次**；overhead p95 87 ms、max 200 ms。雖然總吞吐比 single-process 高 19%（280 vs 236/s），但尾端延遲是 sp 的 ~15×。registry 是一個 JSON 檔 ＋ fail-fast write-lock，是明確的 scale 瓶頸。
- **記憶體**：ATM single-process RSS 140 MB（S1）→ 196 MB（S3）；control 77 → 123 MB。成長大部分是 harness 自己留在記憶體的紀錄（`broker.decisions`、committed list），不是 registry（registry 每次都會 release 乾淨）。8 procs 每個 worker 107–151 MB。
- **多 process 的 reject 比 single-process 多一點**（S1 116 vs 97、S3 605 vs 540）：真平行讓重疊時間窗變了；這不是錯誤，但「多少 % 被 reject」在部署時會比單一 process 的量測稍高。

## 2. Multi-process registry 計數（S1/S2/S3/S4 的 8 procs runs）

| run | txns | 重試過的 txns | CAS conflicts（lock-busy / stale-generation） | 最多重試 | polls | apply-lock spins | registry 殘留 | worker exit≠0 / errors |
|---|---|---|---|---|---|---|---|---|
| S1 r1 | 2780 | 1573（57%） | 5746（5376 / 370） | 23 | 0 | 5 | 0 | 0 / 0 |
| S1 r2 | 2792 | 1516（54%） | 5294（4929 / 365） | 17 | 0 | 8 | 0 | 0 / 0 |
| S2 r1（loop） | 3595 | 1676（47%） | 5956（5586 / 370） | 19 | 4180 | 16 | 0 | 0 / 0 |
| S3 r1 | 13883 | 7442（54%） | 25896（24330 / 1566） | 22 | 0 | 31 | 0 | 0 / 0 |
| S4 r1（unpaced） | 2793 | 2248（80%） | 20202（20010 / 192） | 72 | 0 | 0 | 0 | 0 / 0 |

## 3. 結論

1. **8 agents × 200 trials（以及 × 1000 trials）在 box 上可以穩定地跑完**，single-process 和 8 個 OS process 都可以；real ATM 的每筆成本不隨規模變大（~5 ms sp／~8–10 ms mp）。
2. **正確性在規模下維持住**：所有 ATM runs 都是 0 lost update（前提一樣：sync writer ＝ 理想的 composer apply；見 HOT_FILE_LATENCY.md 的 stale-writer 對照）。
3. **要往更大規模走之前的瓶頸**：（a）沒有思考時間時，single-process 上限 ~236 intents/s；（b）跨 process 的 registry CAS 競爭（fail-fast lock，最多重試 72 次）；（c）熱檔＋overlay 的 backlog 會一路長大。前兩個是 ATM registry store 的設計（單一 JSON 檔），第三個要靠原生的 park/queue（GitHub #180）才能有公平、有界的排隊。

## 4. 重跑

```bash
export PATH=/workspace/.nvm/versions/node/v24.21.0/bin:$PATH
cd /workspace/reports/atm-v2-harness
runs/scale/run_matrix.sh          # ~4.5 min（S3 每個 run ~50 s）
node runs/scale/analyze.mjs       # → runs/scale/summary.{json,md}
```
