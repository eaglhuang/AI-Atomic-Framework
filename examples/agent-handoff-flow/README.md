# Agent Handoff Flow

This example is the reference walkthrough for the neutral governance commands added in ATM v0.2.

## Flow

1. Bootstrap a repository:

```bash
node atm.mjs bootstrap --cwd . --task "Bootstrap ATM in this repository"
```

2. Acquire a governed lock:

```bash
node atm.mjs lock acquire --task BOOTSTRAP-0001 --owner agent-a --files src/example.ts --json
```

3. Check the current context budget:

```bash
node atm.mjs budget check --task BOOTSTRAP-0001 --estimated-tokens 256 --inline-artifacts 1 --json
```

4. Guard touched text files before handoff:

```bash
node atm.mjs guard encoding --files docs/notes.md,src/example.ts --json
```

5. Write a continuation summary for the next agent:

```bash
node atm.mjs handoff summarize --task BOOTSTRAP-0001 --json
```

6. Release the lock when the turn is complete:

```bash
node atm.mjs lock release --task BOOTSTRAP-0001 --owner agent-a --json
```

The resulting handoff summary, evidence, and reports live under `.atm/history/`, while the live lock and budget policy stay under `.atm/runtime/`.
