# 2026-10-23 prereg-v3 pilot

Pilot only; no formal data and no win claim. Read `VERDICT.md` for results and limitations, `CONDITION.json` for the approved reduced allocation, and `formal-runs-plan-v2.md` / `proposed-freeze.json` for the pending proposal.

`run/` is the unchanged pinned kit's sealed output, including its raw smoke/exploratory schema and labels. The enclosing owner-approved condition identifies this execution as a pilot; raw results were not relabelled or rescored. The kit manifest identity is in `kit-identity.json` and the verified public npm runtime identity is in `cli-identity.json`.

`logs/` retains the detached operator stages, including the first offline preflight stop and the subsequent successful full preflight. Raw real-probe and task-session streams are under `run/logs/`. Login homes, credentials and sockets are excluded. `commands.sh` and `operator-cap-wrapper.sh` record operator commands without modifying the immutable kit. The source condition retains the fresh scratch paths for provenance; those paths are host-specific, not portable execution destinations.

Measurements: per-session wall is launcher start to end; tool calls count unique JSONL IDs of command execution, file change, MCP tool call, web search, or generic tool call (started/completed events count once). All four task streams have a terminal turn and no malformed JSON lines. Token fields come from the pinned scorer, with absent total_tokens null. Cached input is a subset of input; reasoning output is a subset of output. Preflight probes are separate from the two task arm runs and four task sessions. Derived input+output proxies appear only as explicitly labelled planning estimates.

Verify immutable archived bytes from this directory:

```bash
sha256sum -c SHA256SUMS
(cd run && sha256sum -c SHA256SUMS)
```

To reproduce the measurement JSON in a fresh copy (not by modifying the sealed generation), run `python3 measurements.py /absolute/path/to/copied/generation`. This parses sealed logs/results and does not call models or rerun the scorer. `receipt-audit.json` records the journal/session matches and accepted-write commit/hash audit. Raw code diffs and snapshot commit logs are under `run/diffs/`.
