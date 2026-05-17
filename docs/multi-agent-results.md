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
