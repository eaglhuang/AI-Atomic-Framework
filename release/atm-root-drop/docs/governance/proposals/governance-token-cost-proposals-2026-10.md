# Proposals: governance reliability and token cost (October 2026)

Companion to [../governance-friction-2026-10.md](../governance-friction-2026-10.md).
Each proposal lists problem, approach, alternatives, risks and acceptance criteria.
**Daily-blocking** proposals (P1, P2, P3, P4, P5) need a design review before
implementation. P6 and P7 build on them.

Common output contract used below ("result line"):

```
ATM-RESULT step=<step> status=<ok|fail> code=<UPPER_SNAKE_CODE> log=<path|-> hint="<one-line fix>"
```

The quick-fix PR adds `scripts/lib/atm-result-line.ts` (format/parse) and uses it in the
sealed build and the CLI test sweep (opt-in log-file mode).

---

## P1. Close survives its caller; shorter critical section (F1, F13) — daily-blocking

**Problem.** `taskflow close --write` runs in the caller's process. When the agent tool call
is aborted, the close dies mid-transaction (0138, 0140). #373 added `--recover/--abort`, but
agents still have to wrap close in `setsid nohup` and poll a file.

**Approach.**
1. `taskflow close --write --detach`: fork a detached child (own session, stdio to
   `.atm/runtime/close/<task>/<attempt>.log`), print one result line
   `status=ok code=CLOSE_STARTED log=<path>` and exit 0. The child writes the final result
   line to `<attempt>.result`.
2. `taskflow close --status --task <id>` (or `--wait [--timeout-ms]`) reads the transaction
   record and prints one result line (running / ok / fail + recover hint).
3. Shorten the critical section: do every read-only step (bundle assembly, validator
   evidence check, line budget, help snapshot, digest computation) *before* acquiring the
   close-window lock; inside the lock only stage, write ledger, commit, release. On start of
   the locked phase, register a heartbeat so a dead holder is detected in seconds, and let
   the next `close` auto-run the `--recover` dry-run and print its verdict.
4. Renew the claim lease automatically while a close or a ship (P7) run is in progress.

**Alternatives.** (a) Keep external `setsid nohup` (status quo; every agent must know it).
(b) A long-lived ATM daemon (heavier; new failure modes).

**Risks.** Orphaned children if the box reboots (covered by #373 recover); two detached
closes for the same task (guard with the existing lock); logs under `.atm/runtime` must
stay gitignored.

**Acceptance.**
- Killing the caller right after `--detach` returns still yields a committed close.
- `kill -9` of the detached child at each phase is recovered by `close --recover` (extend
  `taskflow-close-crash-matrix`).
- Locked-phase wall time is reported and is < 20% of the total close time on a dist task.
- Stdout of `--detach`, `--status` is exactly one result line.

## P2. Deliver bundle never force-adds ignored or generated files (F5, F17) — daily-blocking

**Problem.** Automatic bundle candidates (runner-sync receipt inventory + scope globs) are
staged with `git add -A -f`, so ignored vendored `.d.ts`, run state, nested repos (as
gitlinks) and `.pyc` get committed. Main went from 425 to 1013 tracked `.d.ts`.

**Approach.**
1. Split candidates into *declared* (task `deliverables`, explicitly declared ignored
   artifacts — keep `ignored-artifact-close-bundle.spec.ts` green) and *automatic*
   (receipt inventory, scope-glob expansion).
2. Filter automatic candidates with one batched `git check-ignore --no-index --stdin -z`;
   drop directories that contain `.git` (nested repos) and a fixed denylist
   (`**/__pycache__/**`, `*.pyc`, `kit/state/**`).
3. Report dropped paths as a count plus the first 5 in the result, full list in the log.
4. Runner-sync receipt: record ignored outputs as `generated: true` so verification still
   checks their digests without staging them.
5. One-time cleanup task: `git rm --cached` the tracked-but-ignored files outside
   `research/` evidence after triage, and add a CI check "no new tracked ignored files
   outside an allowlist".
6. (F17) Treat scope `dir/**` as also covering the bare path `dir`.

**Alternatives.** Un-ignore the vendored `.d.ts` (makes every build diff huge); keep
filtering by hand after each close (status quo, error-prone).

**Risks.** `-f` itself is intentional: ATM-BUG-2026-07-15-191 in
`docs/governance/atm-bug-and-optimization-backlog.md` requires auto-stage to keep using
`git add -A -f -- <paths>` (never stdin pathspecs), so keep `-f` and filter the path list
before staging. A consumer of `release/` that relied on committed `.d.ts`; check the onefile and
root-drop parity validators and npm pack contents before the cleanup.

**Acceptance.**
- A close after a full sealed build stages zero ignored files unless declared.
- `ignored-artifact-close-bundle.spec.ts` still passes; new spec covers receipt-inventory,
  gitlink and `.pyc` cases.
- `git ls-files -ci --exclude-standard` outside the allowlist is 0 on main after cleanup.

## P3. Line budget and help snapshot as pre-close gates (F6, F7) — daily-blocking

**Problem.** Two CI-only checks failed after three closes, each costing a new task.

**Approach.** The quick fix provides `npm run preclose:check` and
`npm run help-snapshots:update`. Next step: `taskflow close` (dry-run and write) runs the
same two checks *against the delivery tree merged with the current target branch* before
taking the lock, and refuses with `LINE_BUDGET_EXCEEDED` / `HELP_SNAPSHOT_DRIFT` and a
one-line hint. Optionally the sealed build regenerates help snapshots when a command spec
changed and adds them to the deliverables.

**Alternatives.** Leave it to agent discipline (`preclose:check` only).

**Risks.** Longer dry run (help snapshot needs one CLI help call per command; cache by
command-spec digest).

**Acceptance.** Re-running the 0141/0143/0144 situations in fixtures is refused at close
with the right code; no CI-only failure of these two checks on the next five PRs.

## P4. Amend path for follow-ups before merge (F8) — daily-blocking

**Problem.** A one-line CI fix after a close needs import → claim → sealed build →
receipt → evidence → close → sweep for a new task id.

**Approach.** `taskflow amend --task <closed-id> --reason <text>` allowed only while the
task's delivery commit is not on the default branch (PR still open): reopens a short
"amend window" on the same task and lane, reuses the scope/deliverables, requires evidence
only for the changed files, and closes with an `ATM-Amend` trailer and an amend event in
the task history. Dist changes still require a sealed build, but the receipt is an
incremental update of the existing one.

**Alternatives.** Keep follow-up tasks but generate them from a template in one command
(`taskflow followup --of <id>`): cheaper to implement, still a new id.

**Risks.** Weakens the "closed means immutable" invariant; mitigate by refusing amend once
merged and by recording the amend chain.

**Acceptance.** Fixing a 602-line file after close takes one command plus evidence and one
close, with no new task id; the audit trail shows the amend event.

## P5. One result line for every governance command (F9, F22) — daily-blocking

**Problem.** Agents read hundreds of KB of JSON to learn ok/fail and why.

**Approach.** Every `atm` command and every governance script ends stdout with the result
line above (also under `--json`, as the last line on stderr, or as `result` in JSON).
Add a global `--log-file <path>` that sends the full envelope there. Failure codes map to a
`hint` from `docs/governance/error-code-registry.json` (add a `hint` field). Add
`--help --brief` (usage line + flags only).

**Alternatives.** Rely on `--summary --output-json` (exists for close, but not uniform and
not one line).

**Risks.** Breaking consumers that parse stdout; keep it opt-in for one release behind
`ATM_RESULT_LINE=1`, then default.

**Acceptance.** For import, claim, build, evidence, close, sweep, status: stdout tail is one
parseable result line; failure hints are present for the ten most frequent codes.

## P6. Reuse passed validator results (F10)

**Approach.** Key each validator run by (command, tree hash of its declared inputs, Node
version). `evidence run` stores the key and result; close and the sweep accept a matching
passing record instead of re-running (`--reuse-evidence`, default on for close, opt-in for
sweep). CI keeps running everything.

**Risks.** Undeclared inputs make the key unsound; restrict reuse to validators that
declare inputs, fall back to running otherwise.

**Acceptance.** A close right after `evidence run` with no changes runs zero validators and
says so in the result line.

## P7. `taskflow ship` (F11, F13)

**Approach.** `taskflow ship --task <id> [--build] [--sweep] --detach` = preclose check →
sealed build (if dist scope) → evidence (reused per P6) → close (P1) → clean sweep in a
detached worktree → one final result line and an optional `gh pr checks --watch`.
Depends on P1, P3, P5.

**Acceptance.** One command and one result line take a claimed task to a swept close; an
interrupted ship resumes with `taskflow ship --resume`.

## Backlog items (not daily-blocking)
- F14: reproduce direction locks missing after renew of an *expired* (not released) claim.
- F20: make `broker-native-hot-concurrency.test.ts` deterministic (fake clock or retry
  bound) or quarantine it from the Product CI required set.
