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

## 2026-06-29 - Do not junction a scratch worktree to the main repo node_modules

- Trigger: an agent creates a temporary Git worktree for an isolated repair and
  tries to save time by linking or junctioning that worktree's `node_modules`
  to the main repository's `node_modules`.
- Symptom: removing the scratch worktree can follow reparse points or workspace
  package links and delete tracked files under the main repo's `packages/*` or
  `examples/*`, leaving hundreds of `delete mode` entries and a broken
  `atm.dev.mjs` entrypoint.
- Correct ATM route: never share `node_modules` into a disposable worktree with
  junctions or symlinks. Use the main worktree, install dependencies inside the
  scratch worktree, or run read-only validation from the main repo while keeping
  the scratch tree independent.
- Recovery: before continuing implementation, run `git ls-files -d`; if it is
  non-zero after a scratch-worktree cleanup, restore only missing tracked files
  with `git restore --worktree --pathspec-from-file=-`, reinstall dependencies
  from `package-lock.json`, then rerun a small validator such as
  `npm run typecheck`.
- Durable rule: disposable worktrees must not contain filesystem links that
  point back into mutable directories of the main worktree.

## 2026-06-29 - Treat all-adapter parity drift as one snapshot problem first

- Trigger: `doctor` or `integration verify` starts reporting several installed
  adapters as `stale` right after a framework skill/template change.
- Symptom: the agent sees Claude/Cursor/Copilot/Gemini entries fail parity and
  may chase each one as an isolated bug, even though they are all simply behind
  the same source snapshot.
- Correct ATM route: first test the "old template generation" hypothesis. If
  the affected adapters are just behind the current integration source
  snapshot, refresh the installed adapter set in one governed sync pass, then
  rerun `doctor`.
- Recovery: only stop the bulk sync path when there is evidence of local custom
  edits, adapter-specific install failure, or source snapshot corruption.
- Durable rule: multi-adapter stale parity is usually a shared snapshot drift,
  not six separate product incidents.

## 2026-06-29 - Teach static hygiene as an upper-layer habit before hard gates

- Trigger: the repo wants fewer "CI caught it later" moments for syntax,
  imports, type failures, or new warnings, but the lower adapter-aware gates are
  not fully implemented yet.
- Symptom: the agent treats warnings or obvious local static failures as
  someone else's cleanup problem because only bottom-layer validators are seen
  as authoritative.
- Correct ATM route: first teach the habit in the router and next-entry skills.
  If touched files show obvious static failures or fresh warnings, clear them in
  the same lane whenever the fix is local and low-risk. Then tighten the lower
  `doctor` / `next` / hook gates later.
- Recovery: if historical repo-wide warning debt is large, keep the rule narrow
  to touched or staged scope and record the remaining backlog explicitly instead
  of silently widening the task.
- Durable rule: when a quality behavior can be expressed at the skill layer,
  teach it there first so every adapter learns the expectation before the hard
  enforcement arrives.
