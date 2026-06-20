from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BATCH_ID = 51
STEM = f"hard_batch{BATCH_ID}_clean"

SAMPLES = {
    "md": """# Taskflow close-gate 第51批高難度測試\n\n本次加入更多中文術語與特殊符號：`foreign-staged`、`close-window`、`owner-null`。\n\n- 測試目標：保留 `[]`, `{}`, `()` 的原始結構\n- 測試訊息包含：`fallback-owner`、`blocked`、`runtimeTrace`\n\n流程中請優先確保 `payload.trace.severity` 字串可閱讀，不要誤判成亂碼。\n""",
    "ts": """type RuntimeTrace = {\n  owner: string | null;\n  fallbackOwner?: string | null;\n  payload?: {\n    id?: string | null;\n    owner?: string | null;\n    severity?: \"low\" | \"high\" | \"critical\" | \"blocked\" | null;\n    note?: string | null;\n  } | null;\n};\n\nexport function formatTrace(input: RuntimeTrace): string {\n  const owner = input.owner ?? input.fallbackOwner ?? \"unknown-owner\";\n  const trace = input.payload ?? {};\n  return `${owner} | ${trace.owner ?? owner} | ${String(trace.severity ?? \"unknown\")} | ${String(trace.id ?? \"no-trace-id\")} | ${(trace.note ?? \"關閉閘門前驗證 owner-null\").trim()}`;\n}\n\nconsole.log(\n  formatTrace({\n    owner: null,\n    fallbackOwner: \"team-agent\",\n    payload: {\n      id: \"T-2026-06-20-51\",\n      owner: \"close-gate-owner\",\n      severity: \"critical\",\n      note: \"foreign-staged residue 需要清理\",\n    },\n  })\n);\n""",
    "cs": """public sealed class RuntimePacket\n{\n    public string? Owner { get; init; }\n    public string? FallbackOwner { get; init; }\n    public string? Path { get; init; }\n    public string? Note { get; init; }\n\n    public string Format()\n    {\n        return $\"{Owner ?? FallbackOwner ?? \\\"unknown-owner\\\"}::{Path ?? \\\"docs/agent-briefs/tasks/ATM/taskflow.ts\\\"}::{(string.IsNullOrWhiteSpace(Note) ? \\\"關閉閘門前需記錄 foreign-staged residue\\\" : Note)}\";\n    }\n}\n""",
    "json": """{\n  \"batch\": 51,\n  \"title\": \"Taskflow close-gate 第51批\",\n  \"owner\": \"runtime-owner\",\n  \"fallback_owner\": \"team-agent\",\n  \"meta\": {\n    \"path\": \"packages/core/src/commands/taskflow.ts\",\n    \"tags\": [\"fallback\", \"close\", \"foreign-staged\", \"owner-null\"],\n    \"note\": \"close-window residue 需要保留為可讀中文\"\n  },\n  \"trace\": {\n    \"id\": \"T-2026-06-20-51\",\n    \"owner\": \"task-owner\",\n    \"state\": \"blocked\",\n    \"severity\": \"critical\",\n    \"note\": \"pre-close owner-null 應標記可回溯\"\n  },\n  \"audit\": {\n    \"enabled\": true,\n    \"notes\": [\"active claim\", \"tasks/reconcile\", \"commit-lane\"]\n  }\n}""",
    "py": """from dataclasses import dataclass\nfrom typing import Optional\n\n\n@dataclass\nclass TraceState:\n    owner: Optional[str]\n    fallback_owner: Optional[str]\n    path: Optional[str]\n    note: Optional[str]\n    severity: Optional[str]\n\n\ndef render(state: TraceState) -> str:\n    owner = state.owner or state.fallback_owner or \"unknown-owner\"\n    path = (state.path or \"packages/core/src/commands/taskflow.ts\").strip()\n    severity = (state.severity or \"unknown\").upper()\n    note = (state.note or \"關閉閘門前請確認 foreign-staged residue\").strip()\n    return f\"{owner} | {path} | {severity} | {note}\"\n\n\nif __name__ == \"__main__\":\n    print(\n        render(\n            TraceState(\n                owner=None,\n                fallback_owner=\"runtime-owner\",\n                path=\"  docs/agent-briefs/tasks/ATM/taskflow.md  \",\n                note=\"pre-close owner-null 檢查\",\n                severity=\"critical\",\n            )\n        )\n    )\n""",
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

        out = ROOT / f"{STEM}.{ext}.{mode}"
        out.write_text(corrupted, encoding="utf-8", newline="\n")
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
