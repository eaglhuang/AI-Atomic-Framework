from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BATCH_ID = 52
STEM = f"hard_batch{BATCH_ID}_clean"

SAMPLES = {
    "md": """# TASK-RFT-0010 收尾與 taskflow 縮編驗證

這一批專門驗證最難的中文 Markdown。
我們需要同時保留 `taskflow.ts`、`foreign-staged`、`payload.trace.severity`，還要讓中文句意完整。

- preflight/開工/close 都要可讀
- close-gates-focused.spec.ts 承接快測 close-gate regressions
- taskflow-dryrun.spec.ts 保留代表性大包整合劇本
- 抽出 fixtures / inject / assertions 三層 test atoms

若 owner 為 null，fallback-owner 必須保留，不能讓 active-claim 與 foreign-staged residue 的治理語意消失。
""",
    "ts": """/**
 * 中文註解修復測試：
 * 1. owner 為 null 時，fallback-owner 必須接手。
 * 2. close-window residue 需要保留可回溯證據。
 * 3. payload.trace.severity 為 low 時不可覆蓋 critical。
 */
type RuntimeTrace = {
  owner: string | null;
  fallbackOwner?: string | null;
  payload?: {
    trace?: {
      severity?: "low" | "high" | "critical" | "blocked" | null;
      note?: string | null;
    } | null;
  } | null;
};

export function summarizeTrace(input: RuntimeTrace): string {
  const owner = input.owner ?? input.fallbackOwner ?? "unknown-owner";
  const severity = input.payload?.trace?.severity ?? "unknown";
  const note = input.payload?.trace?.note ?? "任務收尾前請確認 foreign-staged residue";
  return `${owner} | ${severity} | ${note}`;
}
""",
    "cs": """/// <summary>
/// 中文註解修復測試：
/// close-gate 前要保留證據，並避免 owner-null 讓治理語意斷裂。
/// </summary>
public sealed class ClosurePacket
{
    public string? Owner { get; init; }
    public string? FallbackOwner { get; init; }
    public string? Note { get; init; }

    public string Format()
    {
        return $"{Owner ?? FallbackOwner ?? "unknown-owner"}::{(string.IsNullOrWhiteSpace(Note) ? "收尾前請確認 close-window residue" : Note)}";
    }
}
""",
    "json": """{
  "task": "TASK-RFT-0010",
  "status": "close-ready",
  "owner": null,
  "fallback_owner": "team-agent",
  "note": "已知 auto-generated runtime residue 應可辨識並自動清理",
  "trace": {
    "severity": "critical",
    "message": "payload.trace.severity 為 low 時不可覆蓋 critical",
    "summary": "foreign-staged residue 與 active-claim 不一致"
  }
}""",
    "py": """# 中文註解修復測試
# close 前要保留 taskflow 語意與治理詞彙
from dataclasses import dataclass
from typing import Optional


@dataclass
class TraceState:
    owner: Optional[str]
    fallback_owner: Optional[str]
    note: Optional[str]
    severity: Optional[str]


def render(state: TraceState) -> str:
    owner = state.owner or state.fallback_owner or "unknown-owner"
    note = state.note or "收尾前請確認 close-gate regressions 與 foreign-staged residue"
    severity = (state.severity or "unknown").upper()
    return f"{owner} | {severity} | {note}"
"""
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
                    "source_file": clean_path.name
                },
                ensure_ascii=False,
                indent=2
            ),
            encoding="utf-8"
        )


def main() -> int:
    for ext, text in SAMPLES.items():
        write_batch(ext, text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
