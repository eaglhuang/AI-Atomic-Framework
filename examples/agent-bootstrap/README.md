# Agent Bootstrap Example

This example shows how a host repository can adopt ATM without becoming a Node.js application first.

The official local filesystem reference bundle now lives in `packages/plugin-governance-local/`, and this example is the standalone host shape used to prove that bundle works without downstream tooling.

Minimal host type:

- static HTML/CSS repository
- no required package manager
- no required build step

Bootstrap command:

```bash
node packages/cli/src/atm.mjs bootstrap --cwd <host-repo> --task "Bootstrap ATM in this repository"
```

One-line AI kickoff:

```text
Read README.md if present, then read AGENTS.md, .atm/profile/default.md, and .atm/tasks/BOOTSTRAP-0001.json. Continue the bootstrap task without changing the host workflow, and write evidence to .atm/evidence/BOOTSTRAP-0001.json.
```

Standalone self-hosting alpha prompt:

```text
Read README.md. If .atm/config.json is missing, run "node packages/cli/src/atm.mjs bootstrap --cwd . --task \"Bootstrap ATM in this repository\"" from the repository root. Then read AGENTS.md, .atm/profile/default.md, and .atm/tasks/BOOTSTRAP-0001.json, complete the bootstrap task, run the first smoke against examples/hello-world/atoms/hello-world.atom.json, and write artifact, log, evidence, and context summary files under .atm/.
```

Expected generated paths:

- `AGENTS.md`
- `.atm/profile/default.md`
- `.atm/state/project-probe.json`
- `.atm/state/default-guards.json`
- `.atm/tasks/BOOTSTRAP-0001.json`
- `.atm/locks/BOOTSTRAP-0001.lock.json`
- `.atm/evidence/BOOTSTRAP-0001.json`
- `.atm/index/`
- `.atm/shards/`
- `.atm/artifacts/`
- `.atm/logs/`
- `.atm/reports/`
- `.atm/rules/`
- `.atm/registry/`

See `static-site-host/` for a minimal static-site host layout.

See `../../docs/SELF_HOSTING_ALPHA.md` for the alpha proof checklist and Phase B exit gate.