from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BATCH_ID = 53
STEM = f"hard_batch{BATCH_ID}_clean"

SAMPLES = {
    "md": """# TASK-RFT-0011 close-gates-focused.spec.ts / taskflow-dryrun.spec.ts 整併觀察

這一批刻意混入 `taskflow.ts`、`close-gates-focused.spec.ts`、`taskflow-dryrun.spec.ts`、`close-window`、`foreign-staged residue` 等字樣，目的是測試 skill 是否能在長段落裡保住 repo 語意。

| 檢查項目 | 說明 | 期望 |
| --- | --- | --- |
| preflight / ?極 / close | 關閉前先完成 quick check | 不可跳過 |
| focused spec | 承接快測 close-gate regressions | 要可讀 |
| large spec | 保留代表性大包整合劇本 | 不可只剩碎片 |
| atom map | fixtures / inject / assertions 三層拆法 | 名詞要完整 |

請確認 `owner-null` 與 `fallback-owner` 的語意沒有被洗掉，並且 `payload.trace.severity`、`active-claim`、`closure packet` 仍能被辨識。
""",
    "ts": """/**
 * close-gates-focused.spec.ts 與 taskflow-dryrun.spec.ts 的整併說明：
 * 1. 保留代表性大包整合劇本。
 * 2. close-gates-focused.spec.ts 承接快測 close-gate regressions。
 * 3. 抽出 fixtures / inject / assertions 三層 test atoms。
 * 4. 將 test atom 對應回未來 taskflow 的 atom/map 拆法。
 */
export interface CloseGatePlan {
  taskId: string;
  owner: string | null;
  fallbackOwner: string | null;
  note: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export function summarizePlan(plan: CloseGatePlan): string {
  const owner = plan.owner ?? plan.fallbackOwner ?? 'unknown-owner';
  const note = plan.note || '請先處理 foreign-staged residue，再進入 close lane';
  return `${plan.taskId} :: ${owner} :: ${plan.severity} :: ${note}`;
}
""",
    "json": """{
  "task": "TASK-RFT-0011",
  "title": "close-gates-focused spec learning batch",
  "status": "running",
  "owner": null,
  "fallback_owner": "team-agent",
  "labels": ["preflight", "close", "foreign-staged", "owner-null", "atom-map"],
  "note": "請把 taskflow 的 atom/map 拆法與 focused spec 驗證一起保留下來",
  "trace": {
    "severity": "critical",
    "summary": "payload.trace.severity 與 active-claim 應維持可讀",
    "details": {
      "closure_packet": true,
      "close_window": true,
      "residue": "foreign-staged residue"
    }
  }
}
""",
    "py": """# close-gates-focused.spec.ts 的 Python 對照樣本
# 這裡同時測試文字、語意、以及保留 taskflow / close-window / foreign-staged 等詞。
from dataclasses import dataclass


@dataclass
class CloseGateRecord:
    task_id: str
    owner: str | None
    fallback_owner: str | None
    note: str


def render(record: CloseGateRecord) -> str:
    owner = record.owner or record.fallback_owner or 'unknown-owner'
    note = record.note or '請先確認 active-claim 與 closure packet'
    return f'{record.task_id} | {owner} | {note}'
""",
    "cs": """/// <summary>
/// 測試 taskflow-dryrun.spec.ts 與 close-gates-focused.spec.ts 的關聯。
/// 保留 focused spec、large spec、atom/map 拆法、以及 close-gate regressions 的語意。
/// </summary>
public sealed class CloseGateSummary
{
    public string TaskId { get; init; } = string.Empty;
    public string? Owner { get; init; }
    public string? FallbackOwner { get; init; }
    public string Note { get; init; } = string.Empty;

    public string Format()
    {
        var owner = Owner ?? FallbackOwner ?? "unknown-owner";
        var note = string.IsNullOrWhiteSpace(Note) ? "請先清掉 foreign-staged residue 再 close" : Note;
        return $"{TaskId}::{owner}::{note}";
    }
}
""",
}


def corrupt_text(text: str, codec: str) -> str:
    return text.encode("utf-8").decode(codec, errors="replace")


def write_batch(ext: str, text: str) -> None:
    clean_path = ROOT / f"{STEM}.{ext}"
    clean_path.write_text(text, encoding="utf-8", newline="\n")

    for mode in ("latin1", "cp1252", "cp1252_double"):
        if mode == "latin1":
            corrupted = corrupt_text(text, "latin-1")
        elif mode == "cp1252":
            corrupted = corrupt_text(text, "cp1252")
        else:
            corrupted = corrupt_text(corrupt_text(text, "cp1252"), "cp1252")

        out_path = ROOT / f"{STEM}.{ext}.{mode}"
        out_path.write_text(corrupted, encoding="utf-8", newline="\n")
        (ROOT / f"{STEM}.{ext}.{mode}.golden.json").write_text(
            json.dumps(
                {
                    "clean": text,
                    "corrupted": corrupted,
                    "batch": BATCH_ID,
                    "mode": mode,
                    "source_file": clean_path.name,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )


def main() -> int:
    for ext, text in SAMPLES.items():
        write_batch(ext, text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
