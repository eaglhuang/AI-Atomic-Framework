"""Smoke matrix planner. It returns cells and does not start a run."""

import random


def build_plan(selected: list[dict], pins: dict) -> dict:
    cells = []
    for item in selected:
        for seed in pins["seeds"]:
            sequence = list(pins["arms"])
            random.Random(f"{seed}:{item['id']}").shuffle(sequence)
            for order in pins["orders"]:
                for interval in pins["inter_arrival_ms"]:
                    for rank, arm in enumerate(sequence):
                        cells.append(
                            {
                                "item_id": item["id"],
                                "project": item["project"],
                                "write_class": item["write_class"],
                                "seed": seed,
                                "order": order,
                                "inter_arrival_ms": interval,
                                "arm": arm,
                                "arm_rank": rank,
                                "comparison_arm": arm in pins["comparison_arms"],
                                "executed": False,
                            }
                        )
    return {
        "schema": "hist-v2-smoke-plan/1",
        "trial_only": True,
        "formal_run": False,
        "claims_benchmark_wins": False,
        "executed": False,
        "runs_started": 0,
        "seeds": list(pins["seeds"]),
        "orders": list(pins["orders"]),
        "inter_arrival_ms": list(pins["inter_arrival_ms"]),
        "arms": list(pins["arms"]),
        "cells": cells,
        "cell_count": len(cells),
        "per_item_cell_count": (len(cells) // len(selected)) if selected else 0,
    }
