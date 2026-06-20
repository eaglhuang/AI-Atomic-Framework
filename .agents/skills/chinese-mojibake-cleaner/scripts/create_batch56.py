from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BATCH_ID = 56
STEM = f"hard_batch{BATCH_ID}_clean"

SAMPLES = {
    "md": """# TASK-RFT-0014 最難中文文件驗收

這一批直接對準 repo 裡最容易失真的中文任務卡與治理說明。目標不是只把亂碼壓下去，而是要把整句修回可以直接拿去讀的狀態。

| 項目 | 說明 | 驗收 |
| --- | --- | --- |
| 任務卡 | 請先確認 task ID、status 與 scope 是否一致 | 不能改壞 |
| 治理說明 | close 前要先清掉 foreign-staged residue | 語意要完整 |
| 大包整合 | `taskflow-dryrun.spec.ts` 保留代表性整合劇本 | 結構要可讀 |
| 快測分流 | `close-gates-focused.spec.ts` 承接 close-gate regressions | 名稱要正確 |

請同時保護 `owner-null`、`fallback-owner`、`payload.trace.severity`、`active-claim`、`closure packet`，而且不要把「確認」「而不是」「關聯」「可讀」這些連接詞洗掉。這批如果能過，才算真的接近最難的中文文件修復。
""",
    "ts": """/**
 * tasks scope repair 的中文說明。
 * 這個命令比 tasks scope add 更強，因為它可以在緊急授權下補回遺漏的 paths，
 * 但仍然不能把關聯與語意洗掉。
 */
export type ScopeRepairHint = {
  taskId: string;
  actorId: string | null;
  emergencyApproval: string | null;
  reason: string | null;
};

export function describeScopeRepair(input: ScopeRepairHint): string {
  const actor = input.actorId ?? 'unknown-actor';
  const reason = input.reason || '請先確認 close-gate regressions，而不是直接跳過 scope repair';
  return `${input.taskId} :: ${actor} :: ${reason}`;
}
""",
    "json": """{
  "taskId": "TASK-RFT-0014",
  "status": "running",
  "owner": null,
  "fallbackOwner": "team-agent",
  "message": "請先確認 foreign-staged residue，再進入 close lane，而不是直接收尾",
  "trace": {
    "severity": "critical",
    "details": "payload.trace.severity 必須保持可讀，active-claim 不能被洗掉",
    "reason": "這是一份治理型 JSON，不能只保留字面噪音"
  },
  "notes": [
    "taskflow-dryrun.spec.ts",
    "close-gates-focused.spec.ts",
    "atom map",
    "closure packet"
  ]
}
""",
    "py": """# 最難中文文件驗收的 Python 對照樣本
# 這裡要測的是整句修復，不是單字補洞。
from dataclasses import dataclass


@dataclass
class ScopeRepairHint:
    task_id: str
    actor_id: str | None
    emergency_approval: str | None
    reason: str | None


def describe_scope_repair(input: ScopeRepairHint) -> str:
    actor = input.actor_id or 'unknown-actor'
    reason = input.reason or '請先確認 foreign-staged residue 與 closure packet，而不是直接收尾'
    return f'{input.task_id} :: {actor} :: {reason}'
""",
    "cs": """/// <summary>
/// 最難中文文件驗收。
/// 這一段要保留 taskflow / close-window / foreign-staged / owner-null，
/// 也要讓「確認」「而不是」「關聯」「可讀」這些詞回到正常句子裡。
/// </summary>
public sealed class ScopeRepairHint
{
    public string TaskId { get; init; } = string.Empty;
    public string? ActorId { get; init; }
    public string? EmergencyApproval { get; init; }
    public string? Reason { get; init; }

    public string Format()
    {
        var actor = ActorId ?? "unknown-actor";
        var reason = string.IsNullOrWhiteSpace(Reason) ? "請先確認 close-gate regressions，而不是直接收尾" : Reason;
        return $"{TaskId}::{actor}::{reason}";
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
