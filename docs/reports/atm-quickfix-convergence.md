# ATM quickfix convergence baseline

## Scope

TASK-PRF-0099 measures one fixed low-risk repair (`packages/cli/src/commands/quickfix.ts`) and keeps the existing fast channel, quickfix lock, pre-commit scope checks, conflict detection, actor attribution, and governed commit. No new command, state machine, broker, or serialization rule is introduced.

## First-principles baseline

The useful invariant is not the number of governance records; it is that an
agent can make a small change while ATM still proves scope and produces a
revertable commit. The old operator recipe duplicated control-plane choices:

| Path | Required operator invocations |
| --- | ---: |
| Legacy explicit route | 6: `next --prompt`, `quickfix claim`, `quickfix status`, focused validator, `git add`, governed commit |
| Converged fast route | 3: `next --claim` (scope + claim), focused validator, governed commit with `--auto-stage` |

The measured call reduction is `(6 - 3) / 6 = 50%`, above ACC-1's 30%
threshold. Scope is still inferred and persisted in `atm.quickfixLock.v1`; the
pre-commit hook still rejects scope drift, file-count overflow, and line-count
overflow. Auto-stage is therefore a removal of a duplicate operator action, not
an authority bypass.

## Runtime observation

The focused projection test (`node --strip-types tests/cli/quickfix-operator-convergence.test.ts`)
is the reproducible candidate check. It exercises both the adopter quickfix
claim and framework-temp claim projections and exits non-zero on a missing
auto-stage bound or a reintroduced `git add`. Wall-clock time is recorded by the
command-backed evidence for TASK-PRF-0099; it is not presented as an end-user
benchmark. A multi-agent throughput/cpu benchmark remains a separate acceptance
measurement and is not inferred from this unit test.

## Candidate change

`buildChannelPlaybook({ channel: 'fast' })` now emits one governed commit command
with `--auto-stage`, explicitly forbids a separate `git add`, and retains the
existing focused-validator and scope-lock steps. The framework temp-claim
template states the same bounded sequence so generated agent instructions do
not reintroduce the removed staging step.

## Safety and stop rule

No fast route may stage files outside the active lock, edit `.atm/history/**`,
close a task card, or skip the focused validator. If a validator, pre-commit
scope check, actor attribution, conflict check, or revertable commit regresses,
revert this small playbook/template patch. Do not trade away parallel agent
execution or logical-conflict detection to improve the call count.
