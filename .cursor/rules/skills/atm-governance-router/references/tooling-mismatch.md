# Tooling Mismatch Lessons

Use this shard for runner-surface parity issues, frozen-vs-source proof, and
tracked governance residue created by setup commands.

## 2026-06-23 - Host runner and framework runner expose different operator surfaces

- Trigger: adopter repo frozen runner and framework source or frozen runner are
  on different capability levels during closeback or evidence work
- Symptom: one repo has `taskflow` or `evidence run`, the other does not, so
  the operator bounces between contradictory routes
- Correct ATM route: diagnose runner capability parity before treating the
  command failure as a normal lifecycle blocker
- Durable rule: when command surfaces differ across repos, suspect runner skew
  before retrying lifecycle operations
- Backlog link: `ATM-BUG-2026-06-23-021`

## 2026-06-24 - Source-first pass is not frozen-runner proof

- Trigger: a dogfood fix changes `CLI`, `close`, `taskflow`, `hook`, or
  `evidence` behavior, and the operator wants to verify the frozen runner path
- Symptom: the agent sees `node atm.dev.mjs` or source tests pass and almost
  concludes that `node atm.mjs` is already updated too
- Correct ATM route: if the proof target is the frozen runner, run
  `ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build`, then rerun the frozen
  entrypoint and judge success from that result
- Durable rule: source-first success is not frozen-runner proof
- Backlog link: `ATM-BUG-2026-06-24-022`

## 2026-06-28 - Identity setup can create tracked governance drift immediately

- Trigger: the agent correctly runs `identity set` early on a protected
  framework branch
- Symptom: `doctor` then fails on unstaged drift in
  `.atm/catalog/registry/actors.json`, and the agent may misread it as
  unrelated runtime noise instead of expected governed residue
- Correct ATM route: treat actor-registry drift as part of the same governed
  identity change; either stage and commit it with the matching lane or
  explicitly restore it before continuing
- Durable rule: early identity preparation is correct, but it can surface a
  tracked actor-registry diff that must be handled intentionally
