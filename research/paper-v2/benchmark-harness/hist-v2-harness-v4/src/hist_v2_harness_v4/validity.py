"""Environment-validity rule (prereg v2.1 A9). Outcome-blind: reads clocks only.

A cell is ``environment-invalid:clock-discontinuity`` when, inside it,
|Δrealtime − Δmonotonic| > 1 s between any two dual-clock stamps, or the
observed submit spread exceeds the designed arrival spread by > 1 s on
either clock. Invalid cells are sealed and listed, excluded from every count,
and re-run once with identical seed/order/interval by the stage runner.
"""

CLOCK_DISCONTINUITY_S = 1.0
STAGE_INVALID_FRACTION = 0.01
INVALID_LABEL = "environment-invalid:clock-discontinuity"


def _stamps(results, extra=()):
    out = list(extra)
    for result in results:
        clocks = result.get("clocks") if isinstance(result, dict) else getattr(result, "clocks", None)
        for stamp in (clocks or {}).get("stamps", []):
            out.append(stamp)
    return [s for s in out if s.get("mono") is not None and s.get("wall") is not None]


def _submit_stamps(results):
    found = []
    for result in results:
        clocks = result.get("clocks") if isinstance(result, dict) else getattr(result, "clocks", None)
        for stamp in (clocks or {}).get("stamps", []):
            if stamp.get("event") == "submit":
                found.append(stamp)
                break
    return found


def cell_validity(results, designed_delays_ms, driver_stamps=()) -> dict:
    stamps = sorted(_stamps(results, driver_stamps), key=lambda s: float(s["mono"]))
    drift = 0.0
    if stamps:
        m0, w0 = float(stamps[0]["mono"]), float(stamps[0]["wall"])
        for stamp in stamps[1:]:
            drift = max(drift, abs((float(stamp["wall"]) - w0) - (float(stamp["mono"]) - m0)))
    designed = 0.0
    delays = [float(value) for value in designed_delays_ms]
    if delays:
        designed = (max(delays) - min(delays)) / 1000.0
    submits = _submit_stamps(results)
    spread_mono = spread_wall = 0.0
    if len(submits) >= 2:
        spread_mono = max(float(s["mono"]) for s in submits) - min(float(s["mono"]) for s in submits)
        spread_wall = max(float(s["wall"]) for s in submits) - min(float(s["wall"]) for s in submits)
    excess = max(spread_mono, spread_wall) - designed
    reasons = []
    if not stamps:
        reasons.append("no-dual-clock-stamps")
    if drift > CLOCK_DISCONTINUITY_S:
        reasons.append("realtime-monotonic-drift")
    if excess > CLOCK_DISCONTINUITY_S:
        reasons.append("submit-spread-exceeds-design")
    return {
        "valid": not reasons,
        "label": None if not reasons else INVALID_LABEL,
        "reasons": reasons,
        "max_realtime_minus_monotonic_s": drift,
        "designed_spread_s": designed,
        "observed_spread_monotonic_s": spread_mono,
        "observed_spread_wall_s": spread_wall,
        "stamp_count": len(stamps),
    }


def stage_should_stop(invalid_cells: int, planned_cells: int) -> bool:
    return planned_cells > 0 and invalid_cells > STAGE_INVALID_FRACTION * planned_cells
