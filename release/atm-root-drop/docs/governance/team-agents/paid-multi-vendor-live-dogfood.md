# Paid Multi-Vendor Live Dogfood

## Scope

This report tracks the operator-authorized paid OpenAI and Anthropic L5 Team
Agents dogfood for `TASK-TEAM-0066`, using the completed `TASK-TEAM-0053`
provider bridge as its implementation baseline. It intentionally excludes raw
credentials and full provider responses.

## Attempt 1

- Date: 2026-07-11
- Team run: `team-d91af3d358c3`
- Requested runtime: `real-agent`
- Requested default provider: `openai` / `responses` / `gpt-5-mini`
- Requested implementer: `anthropic` / `anthropic-messages` /
  `claude-3-5-sonnet`
- Requested review roles: OpenAI
- L5 plan findings: 0
- Governance decision: `human-signoff-required`
- Human authorization: present before execution
- CLI result: success exit with `providerExecutionCount: 0`
- Blocked reason: `broker-only-runtime-never-spawns`
- Paid provider calls observed: 0
- Raw secrets logged in this report: false

The run did not satisfy the live dogfood acceptance criteria. The persisted
runtime contract selected `broker-only` for the Coordinator even though the CLI
specified `--runtime-mode real-agent`. The implicit provider-selection default
overrode the explicit runtime option. The CLI then returned a successful Team
start result despite executing no provider roles.

## Findings

- `ATM-BUG-2026-07-11-094`: explicit runtime selection loses to the implicit
  Coordinator repo default.
- `ATM-BUG-2026-07-11-095`: `--execute` returns success when zero provider
  executions occur.
- During local secret-structure inspection, an operator tool expanded secret
  values into transient diagnostic output. All OpenAI, Anthropic, and Gemini
  credentials used by this workspace must be rotated before another live run.

The operator confirmed the locally displayed credentials were confined to the
operator machine and authorized continued development without rotation.

## Repair Runs

- `TASK-TEAM-0067` repaired direct-provider execution admission and fail-closed
  zero-execution behavior.
- `TASK-TEAM-0068` forwarded governed task scope to OpenAI and Anthropic
  permission checks.
- Anthropic smoke run `team-9c456b856586` executed 4 real roles with
  `claude-sonnet-5`; all 4 returned HTTP 200.
- Mixed L5 run `team-cb84ba65f0ee` executed 10 real roles. All 8 Anthropic
  roles returned HTTP 200. OpenAI Coordinator and Review Agent reached the
  Responses API but returned HTTP 400 because ATM encoded
  `metadata.scopedPathCount` as an integer.
- `TASK-TEAM-0070` normalized OpenAI metadata values to strings and added a
  deterministic request-body assertion.

## Final Paid L5 Run

- Date: 2026-07-11
- Team run: `team-27b16b429317`
- Team level: L5, 10 roles
- Runtime: `real-agent`
- Governance admission: `auto-execution`; `broker-conflict-blocked`: false
- Human paid-call authorization: present
- Provider executions: 10
- OpenAI assignment: Coordinator and Review Agent, `gpt-5.6-sol`
- Anthropic assignment: Implementer plus 7 support roles,
  `claude-sonnet-5`
- Anthropic outcomes: 8 success, HTTP 200
- OpenAI outcomes: 2 failure, HTTP 429 (`insufficient_quota` confirmed by a
  redacted direct Responses probe)
- Worker `task.lifecycle`: false
- Worker `git.write`: false
- Worker self-close: false
- Raw secrets logged in tracked evidence: false

The final run proves that both concrete paid provider backends were invoked,
that role selection and governed scope reached each vendor, and that Anthropic
executed its real bot roles successfully. OpenAI passed ATM admission and
request validation but could not complete generation because the external API
account had no available quota. No credential value or full vendor response is
stored in this report.
