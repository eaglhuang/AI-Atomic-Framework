"""STOP_REPORT text. Counts only. No superiority language."""

from collections import Counter


def render_stop_report(
    *,
    banner: str,
    date: str,
    plan: dict,
    sample: dict,
    observations: list[dict],
    negative: dict,
    counterexamples: list[dict],
    deviations: list[str],
) -> str:
    lines = [
        banner,
        "",
        f"日期：{date}",
        "這份報告只列計數。它不是論文結果，也不比較臂的優劣。",
        "區間：未計算。冒煙停在計數，不估計比較區間。",
        "",
        "## 抽題",
        "",
        f"- 抽中題數：{len(sample.get('selected', []))}",
        f"- 缺的類別：{_join(sample.get('missing_classes') or [])}",
        f"- 拒絕的留出列：{len(sample.get('refused') or [])}",
        f"- 計畫格子：{plan.get('cell_count', 0)}",
        f"- 已執行格子：{sum(1 for row in observations if row.get('executed'))}",
        "",
        "## 每臂每類別",
        "",
        "| 臂 | 類別 | 格子數 | combined_success 計數 | proposal 計數 |",
        "|---|---|---:|---:|---:|",
    ]
    grouped: dict[tuple[str, str], list[dict]] = {}
    for row in observations:
        grouped.setdefault((str(row.get("arm")), str(row.get("write_class"))), []).append(row)
    if not grouped:
        lines.append("| （無觀察） |  | 0 | 0 | 0 |")
    for arm, write_class in sorted(grouped):
        rows = grouped[(arm, write_class)]
        lines.append(
            "| {arm} | {write_class} | {cells} | {success} | {proposals} |".format(
                arm=arm,
                write_class=write_class,
                cells=len(rows),
                success=sum(int(row.get("combined_success_count") or 0) for row in rows),
                proposals=sum(int(row.get("proposal_count") or 0) for row in rows),
            )
        )
    batch = Counter(str(size) for row in observations for size in row.get("batch_sizes") or [])
    terminals = Counter(str(name) for row in observations for name in row.get("terminals") or [])
    lines.extend(["", "## batch size 分布", "", _counter_table(batch), "", "## 終態分布", "", _counter_table(terminals)])
    lines.extend(["", "## 負控制", ""])
    if not negative:
        lines.append("未評分。")
    else:
        lines.append(f"全部被抓到：{str(bool(negative.get('all_caught'))).lower()}")
        lines.append("")
        lines.append("| 控制 | caught_as | combined_success | 抓到 |")
        lines.append("|---|---|---|---|")
        for row in negative.get("controls") or []:
            lines.append(
                f"| {row['control']} | {row['caught_as']} | {str(bool(row['combined_success'])).lower()} | {str(bool(row['caught'])).lower()} |"
            )
    lines.extend(["", "## counterexample", ""])
    if not counterexamples:
        lines.append("沒有。")
    else:
        for row in counterexamples:
            lines.append(f"- `{row.get('kind')}` 保留在 `{row.get('path')}`。injected={str(bool(row.get('injected'))).lower()}。")
    lines.extend(["", "## 偏離", ""])
    if not deviations:
        lines.append("沒有。")
    else:
        for item in deviations:
            lines.append(f"- {item}")
    lines.extend(["", "## 建議", ""])
    if counterexamples:
        lines.append("保留全部鑑識資料。不要重跑覆蓋，不要刪除或改寫。不要用這些觀察修改預先登記、分類器規則或答案鍵。由作者決定。")
    elif negative and not negative.get("all_caught"):
        lines.append("有負控制沒被抓到。先改評分器並開新版本，再考慮另一次冒煙。不要在這份封存上修改。由作者決定。")
    elif deviations:
        lines.append("偏離寫在上一節。由作者決定。不要把它們當成臂的優劣。")
    else:
        lines.append("沒有建議。")
    lines.extend(["", "沒有勝出主張。", ""])
    return "\n".join(lines)


def counterexamples_from(observations: list[dict]) -> list[dict]:
    found = []
    for index, row in enumerate(observations):
        kind = _kind(row)
        if kind is None:
            continue
        found.append(
            {
                "kind": kind,
                "injected": False,
                "path": f"forensics/{index:04d}-{kind}.json",
                "observation_index": index,
                "item_id": row.get("item_id"),
                "arm": row.get("arm"),
                "detail": row.get("counterexample_detail") or {},
            }
        )
    return found


def _kind(row: dict) -> str | None:
    raw = row.get("counterexample")
    if raw in {None, "", False}:
        raw = None
    mapping = {
        "lost-effect": "lost-effect",
        "lost_effect": "lost-effect",
        "lost effect": "lost-effect",
        "corruption": "corruption",
        "corrupt": "corruption",
        "損壞": "corruption",
        "inconsistent": "inconsistent",
        "遺失": "lost-effect",
    }
    if raw is not None:
        return mapping.get(str(raw).strip().lower())
    if row.get("status") == "inconsistent":
        return "inconsistent"
    return None


def _counter_table(counter: Counter) -> str:
    lines = ["| 值 | 計數 |", "|---|---:|"]
    if not counter:
        lines.append("| （無觀察） | 0 |")
        return "\n".join(lines)
    for key in sorted(counter):
        lines.append(f"| {key} | {counter[key]} |")
    return "\n".join(lines)


def _join(values: list) -> str:
    return "、".join(str(value) for value in values) if values else "無"
