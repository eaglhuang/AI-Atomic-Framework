# Multi-Agent Confidence Results

Generated at: 2026-05-07T16-30-00Z

These reports are advisory only and do not block alpha0 release.

| Agent | Result | Confidence Ready | Adapter Install + First Command | Charter Entry | Report |
| --- | --- | --- | --- | --- | --- |
| Claude Code | pass | true | pass | pass | tests/agents/results/claude-code-2026-05-07T16-30-00Z.json |
| Cursor | pass | true | pass | pass | tests/agents/results/cursor-2026-05-07T16-30-00Z.json |
| Aider | pass | true | n/a | n/a | tests/agents/results/aider-2026-05-07T16-30-00Z.json |
| GitHub Copilot Agent | pass | true | pass | pass | tests/agents/results/github-copilot-agent-2026-05-07T16-30-00Z.json |
| OpenAI Assistants API | pass | true | n/a | n/a | tests/agents/results/openai-assistants-api-2026-05-07T16-30-00Z.json |

Adapter smoke: `node --experimental-strip-types examples/agent-onboarding-flow/run.ts` installs Claude Code, Cursor, and GitHub Copilot Agent adapters in a temporary host repository, verifies manifests, checks `node atm.mjs next --json`, and detects a charter conflict fixture.

If a future agent profile fails, log the failure as an advisory issue and decide separately whether it blocks alpha1.

---

## How to read this report (TASK-ATD-0030)

The table above is the **summary surface**. The actual report payload per
run lives in:

- `tests/agents/results/<agent>-<timestamp>.json` — per-run summary report.
- `.atm/history/reports/self-host-alpha/<agent>/<timestamp>.json` —
  per-workspace per-run detail (when `self-host-alpha --verify` is invoked
  with `--cwd` of a real repo).

### Field reference

| Column | Meaning |
|---|---|
| **Result** | Top-level smoke verdict: `pass`, `fail`, `skipped`. |
| **Confidence Ready** | True iff `bootstrap + welcome + verify-agents-md` all returned `ok: true` for this agent's onboarding profile. |
| **Adapter Install + First Command** | `pass` iff the integration adapter for this agent installed cleanly and its first-command hint matches `node atm.mjs next --json`. `n/a` when the agent has no bundled adapter. |
| **Charter Entry** | `pass` iff the AGENTS.md rendered for this agent's profile contains the required charter entry markers. `n/a` when the agent profile does not render an AGENTS.md addition. |

### Advisory, not blocking (alpha0)

The confidence report is advisory for alpha0. A `fail` row signals drift
that downstream adopters of that agent will hit — investigate before
promoting a release — but it does not block CI by itself.

When alpha1 lands, the policy will tighten so any `confidenceReady: false`
in a public-tracked agent profile blocks release. The reusable surface to
flip that switch is `scripts/render-agent-matrix.ts` (it already knows the
profile list); the gate would be a single validator that loads the latest
result per agent and asserts `confidenceReady === true`.

### Re-generating the report

Locally, re-run the onboarding flow and confidence smoke:

```bash
node --experimental-strip-types examples/agent-onboarding-flow/run.ts
node atm.mjs self-host-alpha --verify --agent <agent-id> --json
```

The first command exercises the adapter install + first-command path.
The second produces the per-agent confidence envelope. The matrix
regeneration is handled by `scripts/render-agent-matrix.ts` which reads
both surfaces.

### Related

- [`docs/multi-agent-compatibility-matrix.md`](./multi-agent-compatibility-matrix.md)
  — static compatibility surface (agent pack registry × integration adapter
  registry).
- [`docs/SELF_HOSTING_ALPHA.md`](./SELF_HOSTING_ALPHA.md) — the smoke
  contract this report is generated from.
- [`docs/testing-strategy.md`](./testing-strategy.md) — self-host-alpha is
  the heaviest test layer.
