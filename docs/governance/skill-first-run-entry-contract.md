# Skill First-Run Entry Contract

## Outcome and scope

ATM's first touch must establish the selected project, the actual runtime
surface, and initialization shape before it asks an agent to claim work.
The implementation extends existing root help and the existing route engine;
it does not introduce another dispatcher, task registry, or authority model.

The initial friction had three separate causes:

1. An adopter-facing Skill unconditionally described framework-only commands
2. A project could reach prompt routing before initialization/profile gaps were clear
3. The existing guidance engine interpreted otherwise-unclassified project work
   as atom birth and carried a package.json requirement into static-site planning

Skill selection by a model is a separate question. File placement, source tests,
and installed-package tests do not demonstrate that every AI automatically
chooses a Skill. That requires a fresh agent-session experiment per host.

## Minimal sequence

1. Select the project explicitly and locate a verified installed runner
2. Run the runner's root help with `--cwd`, the original `--prompt`, and `--json`
3. Consume `evidence.firstRun`; satisfy the returned selection/preconditions
4. Execute its structured argv, then follow existing setup or next/playbook rules

For example, with a verified shared installation:

```sh
node /absolute/path/to/atm.mjs --help --cwd /selected/project --prompt "Build a small static site" --json
```

An agent can add `--agents codex,cursor` after those adapters have been selected,
or `--agents none` after CLI-only setup has been explicitly selected. The help
command never installs, bootstraps, claims, starts a session, reads credentials,
or changes global agent configuration. It does not run availability probes.

An absent runner is an installation prerequisite, not an uninitialized target.
Do not invoke an unqualified `npm exec -- atm` or fetch a similarly named package.
An old runner without the first-run contract gets a bounded read-only fallback:
its advertised help/version, then help for a supported command. Missing support
requires a compatible official distribution, not repeated unsupported probes.

## Structured contract

`atm.firstRun.v1` is advisory and read-only:

- `runtime`: nearest loaded CLI package version, verified executable identity,
  and relevant command flags filtered by the actual loaded runner registry
- `target`: explicit canonical root, independent framework evidence, layout,
  missing/invalid metadata names, and initialization state
- `versionRelation`: recorded target version versus loaded runtime version;
  a difference is not an upgrade instruction or a capability assertion
- `nextAction`: executable, argument array, working directory, read-only flag,
  prerequisites, and reason; a missing executable remains explicit
- `requires`: selections or blockers for which no executable action is justified

No prompt is interpolated into a generated shell command. Callers must preserve
each argument, especially the original prompt, as a separate process argument.

State behavior:

- No explicit target: select a project; never use the installation as the target
- Missing/unsafe target or symlinked metadata: stop with no executable action
- Special files, unreadable metadata, oversized metadata, or unsafe reserved
  parent directories: stop without redirecting to another reader such as doctor;
  metadata reads are bounded at the opened file descriptor as well as the path
- Uninitialized/partial target: use existing setup's read-only preflight;
  setup still owns target safety, conflict detection, bootstrap, and native bridges
- Legacy bootstrap-only runtime: inspect supported bootstrap help; do not write
  without authoritative target/content preflight and setup authorization
- Invalid metadata/legacy layout: preserve content and use supported diagnosis
- Framework ambiguity: preserve conservative framework guards and clarify identity
- Framework target with an adopter-only runtime: select the framework runner
- Ready initialization shape: ask existing next for the original request

Ready does not mean healthy, authenticated, agent-ready, claimed, scoped, or
authorized to mutate. Claim, scope, admission, broker, guard, evidence, close,
and commit rules remain unchanged. Metadata is shallow and bounded; no task,
history, evidence, home-config, or repository-tree scan is performed by help.

Framework identity uses independent source markers. A package name alone yields
ambiguity. Damaged source identity retains conservative guard behavior, and a
root-drop manifest cannot downgrade framework write guards. Portable bundles
remain identifiable as distribution entrypoints without becoming project targets.

Direct source/npm entrypoints ignore inherited onefile hints. Onefile routing
binds the outer process entrypoint, extraction package root, payload-directory
digest, and ready marker; the launcher retains integrity-verification authority.
Programmatic imports never advertise a test harness as an ATM runner.

## Routing after initialization

Existing classified and evidence-backed guidance routes remain distinct.
Only explicit atom birth reaches the final create-atom branch. Otherwise-
unclassified project work previews the existing `taskflow open --dry-run --json`
plan and identifies scope/validator prerequisites. That planning step does not
create a task or invent package.json. Only the irrelevant package-json-missing
blocker is removed for planning; all other blockers remain visible.

## Thin entry and six-host projection

The canonical router template remains under `templates/skills`. Its tracked
package projection must match byte-for-byte. Advanced governance obligations
remain in the mandatory linked `references/advanced-governance.md`, read before
governed mutation. Actor identity, Charter injection, and the ATM-only execution
warning stay in the primary entry.

The compiler ships companion references for Claude Code, Codex, Cursor, Copilot,
and Gemini; Antigravity receives the same corpus through its native bridge.
Relative reference paths follow each adapter's existing native entry layout.
Codex's native bridge, Cursor's always-on rule, and Antigravity's root entry
delegate first touch to the same router. Existing user-edited entries/references
remain subject to manifest ownership and safe-merge conflict handling.

## Verification and friction measurements

The focused regressions are `first-run-entry.test.ts` and
`first-run-skill-parity.test.ts`; both are registered in the existing CLI lane.
They cover static sites without a package manifest, multiple targets/shared
runners, official bootstrap, missing profiles, malformed/future/legacy config,
symlinks and configured global roots, mismatched target versions, limited
runtime surfaces, onefile/root-drop provenance, all prior guidance route
families, all six installed reference paths, native bridges, and user edits.

Measure mandatory entry lines/bytes, command count, unsupported-command count,
zero-write snapshots, cold help latency, and exact installed runtime/template
hashes. The previous mandatory template contained 482 lines; the thin entry is
131 lines, with advanced rules retained in a 469-line companion. These are
source-disclosure measurements, not an AI success-rate or latency improvement.

Package acceptance must use an isolated official build output and real
installation, bind results to the full source digest and tarball hash, and
exercise next/guide/start/taskflow from a clean adopter. Preserve canonical
dist/release artifacts while doing local acceptance. A packaging fixture is not
a published npm release or a sealed production runner.

The existing Skill validator intentionally counts tracked companion files.
Before a new reference is admitted through governed staging/delivery, its
untracked status can fail that delivery gate. Do not weaken the tracking check
to make a local worktree appear published or fully admitted.

## Rollout and rollback

Keep this change local until independent review and publication authorization.
Publish source/schema/compiler/template/tests together; refresh installed
projections and sealed runtime outputs through the normal steward workflow.
If a runtime fails entry verification, retain the original project and runner,
report the exact blocker, and use only the supported read-only fallback.
Rollback the cohesive source delivery and regenerate projections from the
previous sealed corpus; do not delete user-owned configuration or task state.
