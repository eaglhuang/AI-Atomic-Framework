# ATM Governance Router Learning Loop

Use this reference when `atm-governance-router` worked, but the agent still
felt friction, confusion, or nearly bypassed ATM.

Goal: turn repeated wall-hits into a better entry skill without filling the
main `SKILL.md` with noise.

## What To Capture

Capture only cases that are reusable across ATM work, not one-off repo trivia.

Good capture targets:

- first-touch entry confusion;
- repeated misunderstanding of `next`, `playbook`, `framework-mode`, or claim;
- blockers that need a shorter mnemonic rule;
- fallback rules that should become explicit.

Do not capture:

- private project details better kept in repo docs;
- one-time user preference;
- noise that did not change the routing decision.

## Fast Capture Template

Record the lesson in this shape:

```md
## YYYY-MM-DD - short title

- Trigger: what kind of prompt or repo state caused the problem
- Symptom: what the agent almost did wrong or found confusing
- Correct ATM route: the exact safer route
- Durable rule: one short sentence worth reusing
- Promotion target:
  - `SKILL.md` if this changes the core entry contract
  - `learning-loop.md` if this is still a pattern/example
  - repo docs if this is host-specific
```

## Promotion Rules

Promote a lesson from this reference into `SKILL.md` when one of these is true:

1. The same mistake happened at least twice.
2. The mistake risks ATM bypass, unsafe edits, or wrong close/commit order.
3. The fix can be expressed as a short general rule with broad value.

Keep `SKILL.md` short. Promote the rule, not the whole story.

## Suggested Learning Categories

### Entry Friction

- The agent did not realize this skill is the default ATM entrypoint.
- The agent jumped into local reads/edits before `next`.

### Route Interpretation

- The agent saw `no-work`, `task-no-work`, `framework-temp-claim-required`, or
  `playbook required` and misread what to do next.

### Boundary Confusion

- The agent mixed planning-repo work with target-repo execution.
- The agent missed a framework-temp claim requirement.

### Fallback Design

- A tool-first path failed and the CLI fallback rule was unclear.
- A fallback existed, but the agent used a weaker or noisier path than needed.

## Quality Bar

A useful learning item should make a future agent faster or safer within a few
seconds of reading it.

If the lesson needs a long essay to explain, it probably belongs in repo docs,
not in this skill.
