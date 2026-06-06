# Agent Bootstrap Example

This example shows how a host repository can adopt ATM without becoming a Node.js application first.

The official local filesystem reference bundle now lives in `packages/plugin-governance-local/`, and this example is the standalone host shape used to prove that bundle works without downstream tooling.

Minimal host type:

- static HTML/CSS repository
- no required package manager
- no required build step

Bootstrap command:

```bash
node atm.mjs bootstrap --cwd <host-repo> --task "Bootstrap ATM in this repository"
```

One-line AI kickoff:

```text
Read README.md if present, then run "node atm.mjs next --json" from the repository root and execute exactly the returned next action.
```

Standalone self-hosting alpha prompt:

```text
Read README.md if present, then run "node atm.mjs next --json" from the repository root and execute exactly the returned next action.
```

Expected generated paths:

- `AGENTS.md`
- `.atm/runtime/profile/default.md`
- `.atm/runtime/current-task.json`
- `.atm/runtime/project-probe.json`
- `.atm/runtime/default-guards.json`
- `.atm/runtime/budget/default-policy.json`
- `.atm/history/handoff/BOOTSTRAP-0001.json`
- `.atm/history/handoff/BOOTSTRAP-0001.md`
- `.atm/history/tasks/BOOTSTRAP-0001.json`
- `.atm/runtime/locks/BOOTSTRAP-0001.lock.json`
- `.atm/history/evidence/BOOTSTRAP-0001.json`
- `.atm/history/reports/context-budget/bootstrap-bootstrap-BOOTSTRAP-0001.json`
- `.atm/history/reports/continuation/BOOTSTRAP-0001.json`
- `.atm/catalog/index/`
- `.atm/catalog/shards/`
- `.atm/history/artifacts/`
- `.atm/history/logs/`
- `.atm/history/reports/`
- `.atm/runtime/rules/`
- `.atm/catalog/registry/`

See `static-site-host/` for a minimal static-site host layout.

See `../../docs/SELF_HOSTING_ALPHA.md` for the alpha proof checklist and Phase B exit gate.
