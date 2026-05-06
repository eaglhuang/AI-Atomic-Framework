# Agent Bootstrap Example

This example shows how a host repository can adopt ATM without becoming a Node.js application first.

Minimal host type:

- static HTML/CSS repository
- no required package manager
- no required build step

Bootstrap command:

```bash
node packages/cli/src/atm.mjs init --cwd <host-repo> --adopt default --task "Bootstrap ATM in this repository"
```

One-line AI kickoff:

```text
Read README.md if present, then read AGENTS.md, .atm/profile/default.md, and .atm/tasks/BOOTSTRAP-0001.json. Continue the bootstrap task without changing the host workflow, and write evidence to .atm/evidence/BOOTSTRAP-0001.json.
```

Expected generated paths:

- `AGENTS.md`
- `.atm/profile/default.md`
- `.atm/state/project-probe.json`
- `.atm/state/default-guards.json`
- `.atm/tasks/BOOTSTRAP-0001.json`
- `.atm/locks/BOOTSTRAP-0001.lock.json`
- `.atm/evidence/BOOTSTRAP-0001.json`
- `.atm/artifacts/`
- `.atm/logs/`

See `static-site-host/` for a minimal static-site host layout.