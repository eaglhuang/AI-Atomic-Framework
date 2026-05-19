# Agent Pack Onboarding

Agent pack onboarding is ATM's first-touch experience for a repository that wants AI agents to discover the governed workflow quickly. It belongs to the Agent Operating Layer and remains separate from `packages/core` contracts.

The goal is simple: a new agent should learn the local ATM route before editing files, see the active rule summary, and keep all governed actions moving through `node atm.mjs next --json`.

## Public Contract

Agent pack onboarding is made of four cooperating surfaces:

| Surface | Purpose | Must not do |
| --- | --- | --- |
| `atm welcome` | Print a first-touch orientation, installed integration status, ATMChart summary, and the next command to run. | Replace `atm next` or mark work complete by itself. |
| `atm-chart` | Render and verify `.atm/memory/atm-chart.md` from default guards and schema hashes. | Become a new authority above AtomicCharter or host governance. |
| Agent entry files | Provide host-native shortcuts for Claude Code, GitHub Copilot, Cursor, Gemini, Antigravity, Windsurf, or similar environments. | Introduce a parallel task store, approval workflow, or rule system. |
| Integration manifests | Record generated file hashes so install, verify, and uninstall remain deterministic. | Delete user-modified files without a hash match. |

## ATMChart

ATMChart is a rendered, human-readable rule summary for the current repository. It is generated from machine-readable sources such as default guards and schema hashes, then written to `.atm/memory/atm-chart.md`.

ATMChart is not the same thing as AtomicCharter:

- AtomicCharter defines framework-level invariants and waiver authority.
- ATMChart summarizes the active onboarding rule view that agents should read during first contact.

Freshness is part of the contract. If the source guards or schema hashes change, `node atm.mjs atm-chart verify` should fail until the chart is rendered again.

## First-Touch Flow

A typical adopter flow is:

1. Place an ATM distribution in the target repository root.
2. Ask the agent to read the repository entry guidance.
3. Run `node atm.mjs welcome --json` or the plain text `welcome` command for orientation.
4. Run `node atm.mjs atm-chart render` when the chart is missing or stale.
5. Run `node atm.mjs next --json`, show `ATM_USER_NOTICE` or `evidence.userNotice` if present, then execute the returned command.
6. After onboarding or refresh commands finish, return to the user original request and continue the actual work.

The welcome command may summarize state, but the deterministic router remains `next`.

## Agent Packs And Integrations

Agent packs are host-native entry files generated from framework-neutral templates. They make ATM visible in environments with different instruction or command formats, while keeping the same command route underneath.

Adapter-specific discovery differences are documented in:

- `docs/ANTIGRAVITY_INTEGRATION.md` for Antigravity (`GEMINI.md` + `.agents/skills`)
- integration package READMEs for Codex, Claude Code, Copilot, Cursor, and Gemini

Expected pack behavior:

- install files only in the target agent environment's native directory;
- record generated file hashes in a manifest;
- verify that generated entries still preserve `node atm.mjs next --json`;
- uninstall only files whose hashes still match the manifest;
- keep static prompts small and route live decisions to the CLI.

This keeps convenience at the edge and governance in ATM.

## Boundary Rules

- Do not put host-specific agent behavior in `packages/core`.
- Do not let a generated prompt become the source of truth for task state, approvals, or rule changes.
- Do not hide a stale ATMChart; stale source hashes should block freshness checks.
- Do not treat first-touch onboarding as proof that a work item is complete.
- Keep public documentation adopter-neutral. Internal project task cards and planning notes should stay in the coordinating host workspace.

## Validation

Contributors should keep onboarding documentation aligned with the standard validation profile:

```bash
npm run validate:neutrality
npm run validate:standard
```

Command-level smoke checks should continue to include:

```bash
node atm.mjs welcome --json
node atm.mjs atm-chart render --json
node atm.mjs atm-chart verify --json
node atm.mjs next --json
```
