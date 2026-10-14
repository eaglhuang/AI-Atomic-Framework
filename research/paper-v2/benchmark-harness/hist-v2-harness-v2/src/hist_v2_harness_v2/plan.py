"""Run-matrix planner. It returns a plan and does not start a run."""

import random

from .limits import ARMS, COMPARISON_ARMS, INTER_ARRIVAL_MS, ORDERS, SEEDS


def build_plan(fixture_ids: list[str]) -> dict:
    cells = []
    for fixture_id in fixture_ids:
        for seed in SEEDS:
            sequence = list(ARMS)
            random.Random(f"{seed}:{fixture_id}").shuffle(sequence)
            for order in ORDERS:
                for interval in INTER_ARRIVAL_MS:
                    for rank, arm in enumerate(sequence):
                        cells.append(
                            {
                                "fixture_id": fixture_id,
                                "seed": seed,
                                "order": order,
                                "inter_arrival_ms": interval,
                                "arm": arm,
                                "arm_rank": rank,
                                "comparison_arm": arm in COMPARISON_ARMS,
                            }
                        )
    comparison = [cell for cell in cells if cell["comparison_arm"]]
    return {
        "executed": False,
        "runs_started": 0,
        "seeds": list(SEEDS),
        "orders": list(ORDERS),
        "inter_arrival_ms": list(INTER_ARRIVAL_MS),
        "arms": list(ARMS),
        "comparison_arms": list(COMPARISON_ARMS),
        "cells": cells,
        "cell_count": len(cells),
        "comparison_cell_count": len(comparison),
        "per_fixture_cell_count": len(cells) // max(1, len(fixture_ids)),
        "per_fixture_comparison_cell_count": len(comparison) // max(1, len(fixture_ids)),
    }
