from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BATCH_ID = 54
STEM = f"hard_batch{BATCH_ID}_clean"

SAMPLES = {
    "md": """# TASK-RFT-0012 中文文件修復策略

這一批的目標是確認 skill 能穩定修回 repo 內真正會出現的中文說明，而不是只靠猜字。

| 項目 | 說明 | 驗收 |
| --- | --- | --- |
| 任務卡 | 保留 task ID、狀態與驗證條件 | 不能改壞 |
| 治理說明 | close 前要先清掉 foreign-staged residue | 語意要完整 |
| 大包整合 | `taskflow-dryrun.spec.ts` 保留代表性劇本 | 結構要可讀 |
| 快測分流 | `close-gates-focused.spec.ts` 承接 regressions | 名稱要正確 |

請優先保護 `owner-null`、`fallback-owner`、`payload.trace.severity`、`active-claim`、`closure packet` 這些詞，因為它們是 repo 裡最常回頭搜尋的關鍵字。
""",
    "ts": """/**
 * 中文註解修復測試。
 * 這裡要同時保留 taskflow / close-window / foreign-staged / owner-null。
 */
export type DecisionHint = {
  taskId: string;
  owner: string | null;
  fallbackOwner: string | null;
  note: string;
};

export function buildHint(input: DecisionHint): string {
  const owner = input.owner ?? input.fallbackOwner ?? 'unknown-owner';
  const note = input.note || '請先確認 close-gate regressions 與 closure packet';
  return `${input.taskId} :: ${owner} :: ${note}`;
}
""",
    "json": """{
  "taskId": "TASK-RFT-0012",
  "status": "running",
  "owner": null,
  "fallbackOwner": "team-agent",
  "message": "請先清理 foreign-staged residue，再進入 close lane",
  "trace": {
    "severity": "critical",
    "details": "payload.trace.severity 必須保持可讀，active-claim 不能被洗掉",
    "notes": [
      "taskflow-dryrun.spec.ts",
      "close-gates-focused.spec.ts",
      "atom map"
    ]
  }
}
""",
    "py": """# 中文註解修復測試
# 這裡測的是可讀性，不是硬塞字數。
from dataclasses import dataclass


@dataclass
class DecisionHint:
    task_id: str
    owner: str | None
    fallback_owner: str | None
    note: str


def build_hint(input: DecisionHint) -> str:
    owner = input.owner or input.fallback_owner or 'unknown-owner'
    note = input.note or '請先確認 foreign-staged residue 與 closure packet'
    return f'{input.task_id} :: {owner} :: {note}'
""",
    "cs": """/// <summary>
/// 中文註解修復測試。
/// 目標是把 taskflow / close-window / foreign-staged / owner-null 都保留下來。
/// </summary>
public sealed class DecisionHint
{
    public string TaskId { get; init; } = string.Empty;
    public string? Owner { get; init; }
    public string? FallbackOwner { get; init; }
    public string Note { get; init; } = string.Empty;

    public string Format()
    {
        var owner = Owner ?? FallbackOwner ?? "unknown-owner";
        var note = string.IsNullOrWhiteSpace(Note) ? "請先確認 close-gate regressions 與 closure packet" : Note;
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
