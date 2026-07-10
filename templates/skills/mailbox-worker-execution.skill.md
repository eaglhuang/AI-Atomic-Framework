---
schemaId: atm.skillTemplate
specVersion: 0.1.0
id: mailbox-worker-execution
title: Mailbox Worker Execution
summary: Mailbox worker execution workflow for agents that claim dispatch cards, complete scoped work, run required checks, and report done or blocked with evidence.
command: node atm.mjs next --prompt "$ARGUMENTS" --json
firstCommand: node atm.mjs next --prompt "$ARGUMENTS" --json
charter-invariants-injected: true
handoffs: node atm.mjs handoff summarize --task "$ARGUMENTS" --json
---

# {{title}}

Use this skill for worker intake threads that receive or claim mailbox dispatch
cards from a captain, broker, or Team Agents lane.

The worker's job is not to acknowledge the card. The worker's job is to read the
card fully, complete the required scoped work, run required validators or
checks, and only then report completion. If the required work cannot be finished,
report a blocker honestly.

{{ACTOR_IDENTITY_HANDOFF_GATE}}

## Worker Intake Rule

Before claiming a dispatch, identify the worker actor id for this editor/thread.
If this worker is taking over a reused editor, reused worktree, or previous
agent's mailbox, clear stale default identity first and set the worker's own
actor-scoped identity.

Do not inherit the captain's identity. Do not use a repo default identity as
permission to claim, edit, close, report, or commit.

## First Command

```bash
{{firstCommand}}
```

After every `next --prompt` or `next --claim` response, read
`evidence.nextAction.playbook` before editing, closing, or committing.

## Core Rule

Treat the active dispatch card as the authority. Follow its scope, deliverables,
validators, report contract, and write boundary.

## Team Agents Worker Rule

If the dispatch comes from a Team Agents lane, the worker remains bounded even
when the Team runtime used `team start --execute`:

- Do not self-close, self-commit, or claim `task.lifecycle` / `git.write`.
- Respect L1 through L5 role boundaries and only perform the role assigned to
  this worker.
- If the report contains `broker-conflict-blocked`, stop and report the
  blocker; do not continue through local edits or hook bypass.
- Include `atm.teamProviderRunArtifact.v1`, `atm.reviewAgentSignature.v1`, real
  observability events, or `knowledge.query` output when those are the required
  evidence surfaces for the role.

## Completion Rule

Report completion only when the required work is actually finished. Do not mark
done merely because the card was read, claimed, one command was run, one check
passed, or a report body was drafted.

If uncertain whether the card is complete, the safe default is to report what
remains and mark the work blocked or partial instead of done.

## Report Rule

When work is complete, include command-backed evidence when required, list what
changed, and state validator PASS/FAIL clearly. Do not send thin reports such as
`ok`, `done`, or `PASS` without details.

## Handoff

```bash
{{handoffs}}
```

## Charter Invariants

{{CHARTER_INVARIANTS}}
