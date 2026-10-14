"""Score the five harness injections. They are not arm observations."""


def collect_negative_controls() -> dict:
    from hist_v2_harness_v2.negative import CONTROLS, inject

    rows = []
    for name in CONTROLS:
        caught = inject(name)
        combined = bool(caught["combined"].get("counts_as_success"))
        rows.append(
            {
                "control": name,
                "injected": True,
                "caught_as": caught["caught_as"],
                "combined_success": combined,
                "caught": bool(caught["caught_as"]) and not combined,
            }
        )
    return {
        "injected": True,
        "all_caught": all(row["caught"] for row in rows) and len(rows) == len(CONTROLS),
        "controls": rows,
    }
