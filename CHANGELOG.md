# Changelog

## [Unreleased] - 2026-10-20

Post-paper mainline changes landed after `v0.9.0-alpha.1`.

This section records adopter-visible behavior, release-surface fixes,
new benchmark/evidence tracks, and the first shipped ATM skill growth
bridge after the paper-aligned public release.

### Date and version conventions

- History reviewed through [2cd1a48ca](https://github.com/eaglhuang/AI-Atomic-Framework/commit/2cd1a48ca76b8a301df919635c2ae6720d2b51f1), using the complete reachable Git history. New daily entries use the cited commit's **committer date converted to UTC**; author/event dates and later merge dates can differ. They are not release dates. Previously recorded dates remain historical labels, and later fixes supersede earlier implementation details.
- The older `[0.1.0]`–`[0.9.0]` sections below are **May–June development milestones**, retained from this changelog. They are not the later npm `0.1.x` release sequence. In particular, the June 23 `[0.9.0]` milestone is not a stable npm `0.9.0` release.
- The paper snapshot is [v0.9.0-alpha.1](https://github.com/eaglhuang/AI-Atomic-Framework/releases/tag/v0.9.0-alpha.1): source commit [a897f144c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/a897f144c) was recorded on June 24, and its GitHub Release was published **2026-06-24 17:13:59Z**. The historical June 23 milestone and that publication are distinct events.
- Runtime publication dates below come from the CLI's [npm publication metadata](https://registry.npmjs.org/@ai-atomic-framework%2fcli); GitHub Release dates come from the [release records](https://github.com/eaglhuang/AI-Atomic-Framework/releases). A source tag or package.json version does not establish an npm publication date. Package publications can differ: beta.5 has a September 11 GitHub Release but a September 12 CLI npm publication.
- HIST-v2, method preregistration v2.0, classifier/harness generations, and HIST-v3/prereg-v3 name **research artifacts**, not framework release versions. Historical evidence is described as recorded; this changelog update does not rerun those product tests or experiments. Superseded, partial, invalid, and exploratory results retain those limitations.

### Published runtime versions and source tags

`Unreleased` names the current source-line summary, not a new release number. This historical publication index does not reclassify already published versions as unreleased.

The stable npm runtime milestone is **CLI `0.1.0` (2026-09-13)**. The complete observed CLI publication sequence follows in reverse publication order; all dates are UTC. The GitHub Releases list is only a subset of npm publications and source tags. `create-atm` has its own [publication metadata](https://registry.npmjs.org/create-atm), not an assumed identical publication history.

| CLI version | npm publication date (UTC) | Source tag | GitHub Release publication date (UTC) |
| --- | --- | --- | --- |
| `0.1.21` | 2026-10-16 | [v0.1.21](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.21) | No GitHub Release listed |
| `0.1.20` | 2026-10-09 | [v0.1.20](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.20) | No GitHub Release listed |
| `0.1.19` | 2026-10-09 | [v0.1.19](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.19) | No GitHub Release listed |
| `0.1.18` | 2026-10-08 | [v0.1.18](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.18) | No GitHub Release listed |
| `0.1.18-beta.0` | 2026-10-08 | [v0.1.18-beta.0](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.18-beta.0) | [2026-10-08](https://github.com/eaglhuang/AI-Atomic-Framework/releases/tag/v0.1.18-beta.0) |
| `0.1.17` | 2026-10-07 | [v0.1.17](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.17) | No GitHub Release listed |
| `0.1.16` | 2026-10-05 | [v0.1.16](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.16) | No GitHub Release listed |
| `0.1.15` | 2026-10-05 | [v0.1.15](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.15) | No GitHub Release listed |
| `0.1.14` | 2026-10-04 | [v0.1.14](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.14) | No GitHub Release listed |
| `0.1.13` | 2026-10-04 | [v0.1.13](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.13) | [2026-10-04](https://github.com/eaglhuang/AI-Atomic-Framework/releases/tag/v0.1.13) |
| `0.1.12` | 2026-10-04 | [v0.1.12](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.12) | [2026-10-04](https://github.com/eaglhuang/AI-Atomic-Framework/releases/tag/v0.1.12) |
| `0.1.11` | 2026-10-04 | [v0.1.11](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.11) | [2026-10-04](https://github.com/eaglhuang/AI-Atomic-Framework/releases/tag/v0.1.11) |
| `0.1.10` | 2026-10-03 | [v0.1.10](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.10) | [2026-10-03](https://github.com/eaglhuang/AI-Atomic-Framework/releases/tag/v0.1.10) |
| `0.1.9` | 2026-10-03 | [v0.1.9](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.9) | No GitHub Release listed |
| `0.1.8` | 2026-10-03 | [v0.1.8](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.8) | No GitHub Release listed |
| `0.1.7` | 2026-10-03 | [v0.1.7](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.7) | No GitHub Release listed |
| `0.1.6` | 2026-10-02 | [v0.1.6](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.6) | No GitHub Release listed |
| `0.1.5` | 2026-10-01 | [v0.1.5](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.5) | No GitHub Release listed |
| `0.1.4` | 2026-09-30 | [v0.1.4](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.4) | [2026-09-30](https://github.com/eaglhuang/AI-Atomic-Framework/releases/tag/v0.1.4) |
| `0.1.2` | 2026-09-20 | [v0.1.2](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.2) | [2026-09-20](https://github.com/eaglhuang/AI-Atomic-Framework/releases/tag/v0.1.2) |
| `0.1.1` | 2026-09-19 | [v0.1.1](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.1) | No GitHub Release listed |
| `0.1.0` | 2026-09-13 | [v0.1.0](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.0) | [2026-09-13](https://github.com/eaglhuang/AI-Atomic-Framework/releases/tag/v0.1.0) |
| `0.1.0-beta.5` | 2026-09-12 | [v0.1.0-beta.5](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.0-beta.5) | [2026-09-11](https://github.com/eaglhuang/AI-Atomic-Framework/releases/tag/v0.1.0-beta.5) |
| `0.1.0-beta.4` | 2026-08-30 | [v0.1.0-beta.4](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.0-beta.4) | [2026-08-30](https://github.com/eaglhuang/AI-Atomic-Framework/releases/tag/v0.1.0-beta.4) |
| `0.1.0-beta.3` | 2026-08-30 | [v0.1.0-beta.3](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.0-beta.3) | No GitHub Release listed |
| `0.1.0-beta.2` | 2026-08-29 | [v0.1.0-beta.2](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.0-beta.2) | No GitHub Release listed |
| `0.1.0-beta.1` | 2026-08-29 | [v0.1.0-beta.1](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.0-beta.1) | No GitHub Release listed |
| `0.1.0-beta.0` | 2026-08-29 | [v0.1.0-beta.0](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.0-beta.0) | No GitHub Release listed |

The source tag [v0.1.3](https://github.com/eaglhuang/AI-Atomic-Framework/tree/v0.1.3) points to [e07abaaa4](https://github.com/eaglhuang/AI-Atomic-Framework/commit/e07abaaa4) (committer date September 30); the observed CLI npm time metadata contains no `0.1.3` publication, so none is invented here. The beta.4 GitHub record has `prerelease: false` despite its beta name; the identifier is retained. The `0.1.18-beta.0` release notes explicitly target npm `next` without changing `latest`; that historical channel statement is not a claim about today's tags. CLI `0.1.21` was published at **2026-10-16 06:30:42.712Z**, independently of its source-tag creation time.

### Added - major post-paper milestones

- **Provider-neutral Team runtime and handoff contracts (July).** Role skill-pack manifests, runtime capability wiring, and governed handoff ledgers made team execution boundaries explicit ([d45abbfb0](https://github.com/eaglhuang/AI-Atomic-Framework/commit/d45abbfb0), [beeb0da75](https://github.com/eaglhuang/AI-Atomic-Framework/commit/beeb0da75), [16215e90c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/16215e90c)).
- **Receipt-bound composition and causal validation (July).** Shared writes gained steward-bound admission, transactional patch materialization, semantic gates, structured execution receipts, zero-test rejection, and causal validator selection ([c979427a2](https://github.com/eaglhuang/AI-Atomic-Framework/commit/c979427a2), [35a08fc6b](https://github.com/eaglhuang/AI-Atomic-Framework/commit/35a08fc6b), [6ea33fd4a](https://github.com/eaglhuang/AI-Atomic-Framework/commit/6ea33fd4a), [c778a76b8](https://github.com/eaglhuang/AI-Atomic-Framework/commit/c778a76b8)).
- **Installable public runtime (August–September).** Immutable evidence storage and a self-contained npm runtime led to the stable CLI `0.1.0` publication on September 13. This is a separate version line from the earlier development milestones below ([dbcb4ad69](https://github.com/eaglhuang/AI-Atomic-Framework/commit/dbcb4ad69), [ec58da0df](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ec58da0df), [81eae9b39](https://github.com/eaglhuang/AI-Atomic-Framework/commit/81eae9b39)).
- **One-step adopter setup and local task cards (October).** CLI `0.1.8` introduced vendor-neutral `setup`; single-repository adopters can open their own scoped cards, while later first-run fixes keep the current playbook, actor, lane, and validators visible ([14ea2997b](https://github.com/eaglhuang/AI-Atomic-Framework/commit/14ea2997b), [bb486c40b](https://github.com/eaglhuang/AI-Atomic-Framework/commit/bb486c40b), [e42022164](https://github.com/eaglhuang/AI-Atomic-Framework/commit/e42022164)).
- **Shared-compose coordinator and research method milestones (October).** The cross-writer compose coordinator landed alongside HIST-v2 method/classifier work. HIST-v2, harness generations, and prereg-v3 smoke archives are research tracks, not an ATM `2.0` or `3.0` product release. The partial pilot-r2 stopped at 747/1,740 cells and recorded an inconsistent counterexample; the evidence index marks superseded/invalid smoke runs and HIST-v3 as DRAFT / NOT FROZEN. No completed main-run or independent reproduction is asserted ([cb2524243](https://github.com/eaglhuang/AI-Atomic-Framework/commit/cb2524243), [527426f48](https://github.com/eaglhuang/AI-Atomic-Framework/commit/527426f48), [52882594c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/52882594c), [evidence index](research/paper-v2/EVIDENCE_INDEX.md)).

### Fixed - subsequent patch and onboarding corrections

- **Unified patches reject malformed input and preserve per-line EOL.** Strict parsing and offset location were followed by CRLF/LF preservation for each affected line, extending the earlier end-of-file newline fix ([f31d938a9](https://github.com/eaglhuang/AI-Atomic-Framework/commit/f31d938a9), [ccf6bd54b](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ccf6bd54b)).
- **Outcome-first onboarding with verified closure.** README now offers three entry paths and a bounded Bash example that checks exact bytes, successful claim/evidence/close, lane continuity, and the committed result without evaluating arbitrary returned commands ([adf13b16e](https://github.com/eaglhuang/AI-Atomic-Framework/commit/adf13b16e)).

### Fixed - unified diff end-of-file newline

- **Steward apply keeps the `\ No newline at end of file` byte.**
  `applyUnifiedPatch`, the same-file base composer, and region re-compose
  used to drop that unified-diff marker and keep the base file's trailing
  newline. Adding a final newline was lost, removing one left an extra
  newline, and a file that already lacked a trailing newline could be
  rewritten with one. Old and new sides now follow `git apply`, including
  CRLF files and disjoint edits of one file that does not end in a newline.
  The public steward `applyUnifiedPatch` export uses that same applier.

### Added - skill/tool bridge and benchmark tracks

- **Tool bridge result contract v1** plus follow-up operator bridge
  fields for structured CLI-to-skill handoff (`feat(cli): add tool
  bridge result contract v1`, TASK-SKL-0003 / 0004 follow-up delivery).
- **SKL runtime pilot and growth observability** with tool-first
  mirrors, schema artifacts, and frozen-runner lesson linking
  (`47bc59982`, `772331930`, `7599e5580`).
- **ATM AdmissionBench refresh** with rebuilt v0.2 source chain and
  published v0.1 / v0.2 evidence bundles (`2088a791c`, `9a0c03e59`,
  `ab8753b7d`).
- **ATM OperationalBench** public overhead benchmark and supplementary
  evidence publication (`85f2b2f92`, `5294c1bf9`, `f117997c9`).
- **Structured artifact admission evidence track** plus fast-path
  verification and containment evidence (`014ab0fb3`, `7a88af7d3`).

### Changed - release and governance hardening

- **Framework claim preflight in CI and release lanes** so required
  framework governance gates fail earlier and more clearly
  (`ee59316fc`).
- **Sandbox self-hosting template tracking** for the Claude Code agent
  pack (`a7928f4ad`).
- **Paper quick-verify instructions** added to the public docs
  (`a823febb4`).

### Fixed - steward lock across PID namespaces

- **A live commit holder in another PID namespace is no longer treated as dead.**
  The repo lock used to decide liveness from the recorded pid and `/proc`
  start time. Both are local to the caller's PID namespace, so a waiter
  sharing the working tree through `unshare` reclaimed the lock and overwrote
  an acknowledged effect. The lock is now a kernel advisory lock on
  `lock.sqlite` under `<repo>/.atm/runtime/steward-commit-locks`. It releases
  when the holder exits and is visible across PID namespaces on the same
  filesystem. Pid metadata is diagnostic only. If the lock cannot be taken,
  the waiter returns `recovery-required` and does not write.
- **Orphan `*.atm-tmp` siblings are removed only while the exclusive lock is held.**
  A cleanup that cannot acquire the lock leaves a live writer's temp in place.
- **Contending `applyStewardPlan` calls queue per target before composing.**
  The queue is additional ordering. Correctness stays with the file lock and
  the base-hash compare-and-swap. If the queue cannot be used, the apply
  continues on the file lock. Set `ATM_STEWARD_APPLY_QUEUE=off` to skip it,
  `ATM_STEWARD_COMMIT_LOCK_ROOT` to move the lock directory, and
  `ATM_STEWARD_RECOMPOSE_POLICY` to a JSON object to change retry bounds.
  Public CLI flags and the `applied` / `blocked` evidence enum are unchanged.
- **SQLITE_BUSY or SQLITE_LOCKED while opening the apply queue falls back to the file lock.**
  `PRAGMA synchronous = OFF` on `queue.sqlite` can throw `SQLITE_BUSY` while
  another process commits. That error used to escape the apply and leave the
  queue presence file behind. The queue connection now sets `busy_timeout`
  from `ATM_STEWARD_APPLY_QUEUE_WAIT_MS` before the other pragmas. If the
  database is still busy or locked, the apply continues on the per-target
  exclusive lock, and the presence file and queue membership are removed.
  The queue remains ordering only.

### Fixed - steward region re-compose

- **Concurrent steward apply completes disjoint region edits after hash drift.**
  A proposal anchored to a stable region id is rebased onto the current file
  when line numbers have moved. The same region, or a region whose anchored
  lines already changed, stays blocked and is not overwritten. The unlocked
  stale check now returns `re-compose` and enters that retry. Retries are
  bounded by `stewardCanonicalCommitPolicy.maxRecomposeAttempts` (4 extra
  attempts), with `recomposeBackoffMs` and `recomposeJitterMs`. Exhaustion is
  public `blocked` and the reason starts with `re-compose attempts exhausted`.
  The cross-process lock lives at `<repo>/.atm/runtime/steward-commit-locks`
  so different temp directories share it. A dead holder or a reused pid (start
  token mismatch) is reclaimed; a live holder that outlasts the wait is
  `recovery-required`. Public CLI flags and the `applied` / `blocked` evidence
  enum are unchanged.

### Fixed - steward canonical commit

- **Concurrent steward apply no longer silently drops or tears a committed
  effect.** `applyTransactionalStewardPlan` used to re-read the target after
  the stale check and still `writeFileSync` the composition from the old base.
  Two OS processes could both pass that check; the later write replaced the
  earlier effect, and a shorter overlapping write could leave a stale tail
  byte. The commit now holds a per-file lock only around a base-hash
  compare-and-swap and an atomic same-directory rename. A mismatch returns
  transactional verdict `re-compose` and does not write. A live lock that
  outlasts the wait returns `recovery-required`. `applyStewardPlan` recomposes
  once and, if that still cannot commit, keeps the public evidence verdict
  `blocked` with a reason prefixed `re-compose:` or `recovery-required:`.
  Public CLI flags and the public `applied` / `blocked` evidence enum are
  unchanged. Uncontended commit overhead on this host was about 0.09 ms per
  file versus `writeFileSync` (commit mean 0.13 ms, apply mean 0.38 ms over
  200 sequential JSON upserts).

### Fixed - CLI, hook, evidence, and release behavior

- **Completion report detector narrowing** so ordinary governance
  backlog prose stops being treated like closeout evidence
  (`efdb2373f`, `ae654da87`).
- **Repo-local broker evidence path defaults** parameterized and
  guarded by regression coverage (`28d474ee1`, `545c50aa5`).
- **CLI onboarding validation fixture isolation** so `validate:cli`
  no longer depends on polluted onboarding state (`abf028541`).
- **Repo-selection environment sanitization** across wrapper and hook
  lanes (`cd32407a9`).
- **Actor identity and skill integration hardening** including
  explicit governed actor enforcement, `identity clear`, per-actor
  identity resolution, editor/provider mismatch checks, non-critical
  git-head scope narrowing, pre-push worktree-local git-head evidence
  visibility, shared validator fixture contracts, validator duration
  budget reporting, scoped git-lane prompt repair, and governance
  repair git-head evidence backfill (`c589f1250`, `004802818`,
  `f57dbfe0b`, `8006bb7e6`).
- **Main-push audit baseline cleanup** keeps historical release notes
  from being interpreted as task closeout reports and preserves the
  missing PAPER-HOTFILE handoff transition artifact used by the audit
  baseline.

### Daily log

#### 2026-10-20

- Changed README to outcome-first, progressive adoption with one bounded request, three entry paths, explicit runtime/version boundaries, and a fail-closed first-write example ([adf13b16e](https://github.com/eaglhuang/AI-Atomic-Framework/commit/adf13b16e)).

#### 2026-10-19

- Fixed strict unified-patch parsing, offset location, and per-line CRLF/LF preservation; retained malformed-patch and no-newline boundaries ([f31d938a9](https://github.com/eaglhuang/AI-Atomic-Framework/commit/f31d938a9), [ccf6bd54b](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ccf6bd54b)).
- Archived prereg-v3 smoke v10c as exploratory, with Arm B blocked, rather than a product or benchmark success claim ([2626e38c3](https://github.com/eaglhuang/AI-Atomic-Framework/commit/2626e38c3), [evidence index](research/paper-v2/EVIDENCE_INDEX.md)).

#### 2026-10-18

- Fixed the onefile's canonical atom-capsule runtime closure and repaired smoke preflight Python/PATH/probe handling ([e50f192a9](https://github.com/eaglhuang/AI-Atomic-Framework/commit/e50f192a9), [0abd29699](https://github.com/eaglhuang/AI-Atomic-Framework/commit/0abd29699)).

#### 2026-10-17

- Hardened research evaluation provenance: missing evaluator snapshots are invalid, session PATH survives login shells, and false accepts are rejected. The v7/v8 smoke archives remain INVALID ([41d3ab5af](https://github.com/eaglhuang/AI-Atomic-Framework/commit/41d3ab5af), [a2bc011a0](https://github.com/eaglhuang/AI-Atomic-Framework/commit/a2bc011a0), [61bee7533](https://github.com/eaglhuang/AI-Atomic-Framework/commit/61bee7533)).

#### 2026-10-16

- Published CLI `0.1.21` to npm at 06:30:42Z; its source tag points to [3faf627b2](https://github.com/eaglhuang/AI-Atomic-Framework/commit/3faf627b2). Publication verification follows the same immutable candidate rather than treating a tag as registry success.
- Hardened live research writes and sandbox boundaries; corrected gold-test application, offline Django setup, and scoring of runs where tests did not execute ([41122f241](https://github.com/eaglhuang/AI-Atomic-Framework/commit/41122f241), [ba0755172](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ba0755172), [85de2a92f](https://github.com/eaglhuang/AI-Atomic-Framework/commit/85de2a92f)).

#### 2026-10-15

- Added HIST-v2 harness v3 diagnosis and archived the partial pilot-r2; development replay and smoke-kit repair are separate from a frozen, completed experiment ([c8d6f4c67](https://github.com/eaglhuang/AI-Atomic-Framework/commit/c8d6f4c67), [52882594c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/52882594c)).
- Made suggested commands paste-safe and carried known actors into quickfix claims ([74fe2405f](https://github.com/eaglhuang/AI-Atomic-Framework/commit/74fe2405f)).

#### 2026-10-14

- Added the cross-writer shared-compose batch coordinator; recorded the HIST-v2 method preregistration v2.0 and classifier v8 as research artifacts, not framework release versions ([7e244bc60](https://github.com/eaglhuang/AI-Atomic-Framework/commit/7e244bc60), [527426f48](https://github.com/eaglhuang/AI-Atomic-Framework/commit/527426f48), [3ec951fca](https://github.com/eaglhuang/AI-Atomic-Framework/commit/3ec951fca)).

#### 2026-10-11

- Kept claimed next actions at `implement-deliverables`, reported missing Git authors as structured close blockers, and compacted Day-1 JSON ([210454481](https://github.com/eaglhuang/AI-Atomic-Framework/commit/210454481), [58421f600](https://github.com/eaglhuang/AI-Atomic-Framework/commit/58421f600), [879fd632d](https://github.com/eaglhuang/AI-Atomic-Framework/commit/879fd632d)).

#### 2026-10-10

- Embedded ajv and atomization helpers into the onefile and filled registry-backed atom CIDs in proposals/backfill ([859721f86](https://github.com/eaglhuang/AI-Atomic-Framework/commit/859721f86), [de52d5af8](https://github.com/eaglhuang/AI-Atomic-Framework/commit/de52d5af8), [f8395bf27](https://github.com/eaglhuang/AI-Atomic-Framework/commit/f8395bf27)).
- Added HIST-v2 pair-classifier/pre-label tooling and benchmark-redesign drafts; these snapshots are research preparation, not a framework release or an independently validated result ([87bc5fd44](https://github.com/eaglhuang/AI-Atomic-Framework/commit/87bc5fd44), [ec4e30dde](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ec4e30dde)).

#### 2026-10-09

- Made first-run setup usable from the project directory; preserved invocation lanes, staged path bytes, deletions, rename pairs, and verified first pushes to absent remote refs ([1e84a05e9](https://github.com/eaglhuang/AI-Atomic-Framework/commit/1e84a05e9), [4d68f448c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/4d68f448c), [184d735c8](https://github.com/eaglhuang/AI-Atomic-Framework/commit/184d735c8), [3878cde9c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/3878cde9c)).
- Fixed unified-diff EOF newline markers and busy steward queues; isolated validator cleanup from active work ([52f0df8e8](https://github.com/eaglhuang/AI-Atomic-Framework/commit/52f0df8e8), [b35a6141b](https://github.com/eaglhuang/AI-Atomic-Framework/commit/b35a6141b), [f66c84dad](https://github.com/eaglhuang/AI-Atomic-Framework/commit/f66c84dad)).
- Archived HIST trials, an EOF-counterexample-stopped run, and a follow-up rerun. These precede the later HIST-v2 redesign and do not establish a completed HIST-v2 main run or independent reproduction ([8e7cc3967](https://github.com/eaglhuang/AI-Atomic-Framework/commit/8e7cc3967), [8311089e5](https://github.com/eaglhuang/AI-Atomic-Framework/commit/8311089e5), [evidence index](research/paper-v2/EVIDENCE_INDEX.md)).

#### 2026-10-08

- Preserved literal validator comma arguments and narrowed taskflow missing-flag hints; CLI `0.1.18-beta.0` and `0.1.18` have distinct npm publication records ([162274029](https://github.com/eaglhuang/AI-Atomic-Framework/commit/162274029), [210b3f4d7](https://github.com/eaglhuang/AI-Atomic-Framework/commit/210b3f4d7)).
- Archived paper-v2 evidence generations r1–r4, retaining review findings and counterexamples; their draft observations do not imply independent reproduction or a product version increment ([cb2489f2f](https://github.com/eaglhuang/AI-Atomic-Framework/commit/cb2489f2f), [83a91f505](https://github.com/eaglhuang/AI-Atomic-Framework/commit/83a91f505)).
- Closed the multi-process steward lost-update and torn-write window with a
  per-file compare-and-swap and an atomic rename. Public steward evidence
  remains `applied` or `blocked`; transactional receipts may now report
  `re-compose` or `recovery-required`.
- Region-anchored steward proposals now rebase onto the current file after
  hash drift. Disjoint regions can both commit; the same region stays blocked.
  Commit locks moved under the repo `.atm/runtime` directory, with bounded
  re-compose retries and stale-holder reclaim.

#### 2026-10-07

- Added file-heat observation and recoverable hot-conflict parking; composed steward patches against one base and failed closed on unsafe combinations ([23a98b334](https://github.com/eaglhuang/AI-Atomic-Framework/commit/23a98b334), [9ee4e65b0](https://github.com/eaglhuang/AI-Atomic-Framework/commit/9ee4e65b0), [a5a567967](https://github.com/eaglhuang/AI-Atomic-Framework/commit/a5a567967), [65e8aab36](https://github.com/eaglhuang/AI-Atomic-Framework/commit/65e8aab36)).
- Named each claimed card's real validators and provided a route out of the larger-task guide loop ([e42022164](https://github.com/eaglhuang/AI-Atomic-Framework/commit/e42022164), [b880f0cc5](https://github.com/eaglhuang/AI-Atomic-Framework/commit/b880f0cc5)).

#### 2026-10-06

- Changed npm release parity to validate an immutable candidate before promotion, rather than independently rebuilt publication artifacts ([355968c4b](https://github.com/eaglhuang/AI-Atomic-Framework/commit/355968c4b)).
- Added two-phase derived-atom occupancy and surfaced failing validator output tails ([8dd6a1c6d](https://github.com/eaglhuang/AI-Atomic-Framework/commit/8dd6a1c6d), [f8401387c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/f8401387c)).

#### 2026-10-05

- Pinned starter installation to its declared CLI dependency, added runtime-aware first-run routing, and tolerated half-edited package manifests ([95e2711ef](https://github.com/eaglhuang/AI-Atomic-Framework/commit/95e2711ef), [a94948f2c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/a94948f2c), [151642c97](https://github.com/eaglhuang/AI-Atomic-Framework/commit/151642c97)).

#### 2026-10-04

- Let a single-repository adopter open scoped local task cards; added `taskflow abandon` and preserved literal command commas ([bb486c40b](https://github.com/eaglhuang/AI-Atomic-Framework/commit/bb486c40b), [9fdac4e16](https://github.com/eaglhuang/AI-Atomic-Framework/commit/9fdac4e16), [ea260f4c2](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ea260f4c2)).

#### 2026-10-03

- Added vendor-neutral one-step `setup` in CLI `0.1.8`; adopter ignore rules keep `.atm/history` tracked while excluding generated runtime state ([14ea2997b](https://github.com/eaglhuang/AI-Atomic-Framework/commit/14ea2997b), [865de9a8c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/865de9a8c), [4fe97a521](https://github.com/eaglhuang/AI-Atomic-Framework/commit/4fe97a521)).

#### 2026-10-02

- Reused planning-root observations during route scoring, reduced duplicate reproducibility builds, and excluded declared fixture commands from runtime telemetry ([823c13aeb](https://github.com/eaglhuang/AI-Atomic-Framework/commit/823c13aeb), [5b9d354fb](https://github.com/eaglhuang/AI-Atomic-Framework/commit/5b9d354fb), [a89a208a5](https://github.com/eaglhuang/AI-Atomic-Framework/commit/a89a208a5)).

#### 2026-10-01

- Added an always-on Cursor rule, a claimable first-request fast route, and an ATMChart immediately after bootstrap ([256ba48f6](https://github.com/eaglhuang/AI-Atomic-Framework/commit/256ba48f6), [ff2ac0308](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ff2ac0308), [345b4f2a9](https://github.com/eaglhuang/AI-Atomic-Framework/commit/345b4f2a9)).
- Rejected signal-terminated validator outcomes, stopped synthesizing historical validation passes, and made repair/delivery previews side-effect free ([b8001b6ae](https://github.com/eaglhuang/AI-Atomic-Framework/commit/b8001b6ae), [ed317820d](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ed317820d), [1fe6791b2](https://github.com/eaglhuang/AI-Atomic-Framework/commit/1fe6791b2)).

#### 2026-09-30

- Synchronized release-train metadata and validated release dry-runs; repaired observed telemetry coverage ([7b799a433](https://github.com/eaglhuang/AI-Atomic-Framework/commit/7b799a433), [e07abaaa4](https://github.com/eaglhuang/AI-Atomic-Framework/commit/e07abaaa4)).

#### 2026-09-29

- Made npm adopter recovery and bootstrap instructions consistently name a runnable command prefix ([f7c79d9bc](https://github.com/eaglhuang/AI-Atomic-Framework/commit/f7c79d9bc), [3d92eaca5](https://github.com/eaglhuang/AI-Atomic-Framework/commit/3d92eaca5)).

#### 2026-09-28

- Fixed printed npm guidance so its commands can actually be executed ([f3d20e7ba](https://github.com/eaglhuang/AI-Atomic-Framework/commit/f3d20e7ba)).

#### 2026-09-23

- Proved the clean-install first-use path and avoided routing adopters into a nonexistent npm test script ([53f2c6fc0](https://github.com/eaglhuang/AI-Atomic-Framework/commit/53f2c6fc0), [31cb9613c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/31cb9613c), [e974ca80f](https://github.com/eaglhuang/AI-Atomic-Framework/commit/e974ca80f)).

#### 2026-09-22

- Preserved executable npm runtime bins and retained failed Product CI burn-in evidence ([c52c00767](https://github.com/eaglhuang/AI-Atomic-Framework/commit/c52c00767), [239242f94](https://github.com/eaglhuang/AI-Atomic-Framework/commit/239242f94)).

#### 2026-09-21

- Bounded Git output and pathspec batches for temporary-index cleanup; removed three false active-work route blocks ([bc8638e5e](https://github.com/eaglhuang/AI-Atomic-Framework/commit/bc8638e5e), [c84532bdd](https://github.com/eaglhuang/AI-Atomic-Framework/commit/c84532bdd), [8e91890fa](https://github.com/eaglhuang/AI-Atomic-Framework/commit/8e91890fa)).

#### 2026-09-20

- Published CLI `0.1.2` with missing runtime schemas restored; built candidates before packing and stopped duplicating embedded schemas ([cd37f2fc9](https://github.com/eaglhuang/AI-Atomic-Framework/commit/cd37f2fc9), [7638f2c98](https://github.com/eaglhuang/AI-Atomic-Framework/commit/7638f2c98)).

#### 2026-09-19

- Made `atm create` usable from the published package and waited for registry propagation before applying the post-publish gate ([180c79204](https://github.com/eaglhuang/AI-Atomic-Framework/commit/180c79204), [fcedee2da](https://github.com/eaglhuang/AI-Atomic-Framework/commit/fcedee2da)).

#### 2026-09-18

- Added a fail-closed public-registry post-publish check and repaired packaged telemetry's module boundary ([fbdf07f8c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/fbdf07f8c), [54872bf11](https://github.com/eaglhuang/AI-Atomic-Framework/commit/54872bf11)).

#### 2026-09-17

- Reduced `next` latency by deferring expensive scans while retaining pre-claim broker advice; bounded ignored-deliverable scans ([ea675732f](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ea675732f), [5e4e51d62](https://github.com/eaglhuang/AI-Atomic-Framework/commit/5e4e51d62), [9474cc211](https://github.com/eaglhuang/AI-Atomic-Framework/commit/9474cc211)).

#### 2026-09-15

- Prefiltered active queues, measured claim phases in milliseconds, and provided explicit recovery of released staged task records ([32219a899](https://github.com/eaglhuang/AI-Atomic-Framework/commit/32219a899), [ea324151e](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ea324151e), [b732f72a6](https://github.com/eaglhuang/AI-Atomic-Framework/commit/b732f72a6)).

#### 2026-09-14

- Closed the compact npm runtime's chart/schema boundary and deferred full framework status from ordinary `next` calls ([bac08a4b8](https://github.com/eaglhuang/AI-Atomic-Framework/commit/bac08a4b8), [e62546837](https://github.com/eaglhuang/AI-Atomic-Framework/commit/e62546837), [9c59bee27](https://github.com/eaglhuang/AI-Atomic-Framework/commit/9c59bee27)).

#### 2026-09-13

- Reached the stable public npm CLI `0.1.0` milestone with a measured adopter runtime boundary and lazy-loaded command runners ([81eae9b39](https://github.com/eaglhuang/AI-Atomic-Framework/commit/81eae9b39), [d085f0830](https://github.com/eaglhuang/AI-Atomic-Framework/commit/d085f0830)).

#### 2026-09-12

- Added fail-closed Product CI burn-in evaluation, separate historical-failure baselines, and paired-benchmark metric/decision validators ([7f45b1705](https://github.com/eaglhuang/AI-Atomic-Framework/commit/7f45b1705), [e74624857](https://github.com/eaglhuang/AI-Atomic-Framework/commit/e74624857), [aa7263c50](https://github.com/eaglhuang/AI-Atomic-Framework/commit/aa7263c50)).

#### 2026-09-11

- Retried transient Windows onefile-cache rename failures and bounded release validator/job runtime ([a3de11e68](https://github.com/eaglhuang/AI-Atomic-Framework/commit/a3de11e68), [c86f0e297](https://github.com/eaglhuang/AI-Atomic-Framework/commit/c86f0e297)).

#### 2026-09-10

- Moved mutable evidence outside tracked history, hydrated closure packets from the runtime ledger, and separated npm/onefile payload contracts ([6ac164fe8](https://github.com/eaglhuang/AI-Atomic-Framework/commit/6ac164fe8), [010609832](https://github.com/eaglhuang/AI-Atomic-Framework/commit/010609832), [0374416b2](https://github.com/eaglhuang/AI-Atomic-Framework/commit/0374416b2)).

#### 2026-09-09

- Restored scaffold assets in the compact runtime and sped up required CI without dropping its declared coverage ([1853d042f](https://github.com/eaglhuang/AI-Atomic-Framework/commit/1853d042f), [28abd508f](https://github.com/eaglhuang/AI-Atomic-Framework/commit/28abd508f)).

#### 2026-09-08

- Built a compact installable npm runtime and repaired packaged integration-adapter readiness ([9ce4e845a](https://github.com/eaglhuang/AI-Atomic-Framework/commit/9ce4e845a), [d125b81dc](https://github.com/eaglhuang/AI-Atomic-Framework/commit/d125b81dc)).

#### 2026-09-07

- Prevented close from deferring reconciliation residue instead of accounting for it ([8d3b4a3e4](https://github.com/eaglhuang/AI-Atomic-Framework/commit/8d3b4a3e4)).

#### 2026-09-06

- Added bounded adoption of unowned work in progress and separated runtime Git-head journals from tracked receipts ([a50574095](https://github.com/eaglhuang/AI-Atomic-Framework/commit/a50574095), [c7eff27dc](https://github.com/eaglhuang/AI-Atomic-Framework/commit/c7eff27dc)).

#### 2026-09-05

- Reused adopted lane sessions, inspected historical commit/scope spans, and fixed installed-package helper resolution ([138181ded](https://github.com/eaglhuang/AI-Atomic-Framework/commit/138181ded), [9c498d94e](https://github.com/eaglhuang/AI-Atomic-Framework/commit/9c498d94e), [2ac8e8346](https://github.com/eaglhuang/AI-Atomic-Framework/commit/2ac8e8346)).

#### 2026-09-04

- Restored the canonical onefile build boundary and admitted declared ignored deliverables through the governed Git path ([d61f8aaed](https://github.com/eaglhuang/AI-Atomic-Framework/commit/d61f8aaed), [e920670ce](https://github.com/eaglhuang/AI-Atomic-Framework/commit/e920670ce)).

#### 2026-09-03

- Scoped release validators to release work and suppressed optional Git index locks in ATM subprocesses ([6f5343435](https://github.com/eaglhuang/AI-Atomic-Framework/commit/6f5343435), [d04defb7c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/d04defb7c)).

#### 2026-09-02

- Preserved sealed staged blobs and bounded branch-queue waiting by the actual commit timeout ([5228e65ee](https://github.com/eaglhuang/AI-Atomic-Framework/commit/5228e65ee), [f46a27f22](https://github.com/eaglhuang/AI-Atomic-Framework/commit/f46a27f22)).

#### 2026-09-01

- Required explicit broker conflict-release order and preserved terminal-history ownership during cleanup/reconciliation ([f367946a6](https://github.com/eaglhuang/AI-Atomic-Framework/commit/f367946a6), [653d8c7ce](https://github.com/eaglhuang/AI-Atomic-Framework/commit/653d8c7ce)).

#### 2026-08-30

- Bound admission tickets to explicit claim scope and separated benchmark pre-run readiness from final custodian acceptance ([ce731c8f4](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ce731c8f4), [253cfc907](https://github.com/eaglhuang/AI-Atomic-Framework/commit/253cfc907), [c74a6f5f6](https://github.com/eaglhuang/AI-Atomic-Framework/commit/c74a6f5f6)).

#### 2026-08-29

- Closed the standalone CLI's package boundary, bundled skill companions, and verified the tag-versioned tarball. npm CLI beta.0–beta.2 publications began on this UTC date ([ec58da0df](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ec58da0df), [ece36f30d](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ece36f30d), [12c368c94](https://github.com/eaglhuang/AI-Atomic-Framework/commit/12c368c94)).

#### 2026-08-28

- Hardened release-audit discovery and admission for owned ignored candidate artifacts, rather than omitting them from delivery evidence ([ad3eb7275](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ad3eb7275), [39d6cd052](https://github.com/eaglhuang/AI-Atomic-Framework/commit/39d6cd052)).

#### 2026-08-27

- Migrated runtime evidence into an immutable ledger, enforced adopter artifact budgets, and added clean runtime-package installation checks ([dbcb4ad69](https://github.com/eaglhuang/AI-Atomic-Framework/commit/dbcb4ad69), [0e0591329](https://github.com/eaglhuang/AI-Atomic-Framework/commit/0e0591329), [656b6d4f5](https://github.com/eaglhuang/AI-Atomic-Framework/commit/656b6d4f5)).

#### 2026-08-26

- Added repeatable Product CI burn-in dispatch and release-candidate labels ([e3b27c6f5](https://github.com/eaglhuang/AI-Atomic-Framework/commit/e3b27c6f5), [6647e264f](https://github.com/eaglhuang/AI-Atomic-Framework/commit/6647e264f)).

#### 2026-08-25

- Composed disjoint JSON-pointer proposals, persisted explicit merge plans, and preserved typed dependency declarations ([8a9984509](https://github.com/eaglhuang/AI-Atomic-Framework/commit/8a9984509), [5cf291dd2](https://github.com/eaglhuang/AI-Atomic-Framework/commit/5cf291dd2), [bc953fbbe](https://github.com/eaglhuang/AI-Atomic-Framework/commit/bc953fbbe)).

#### 2026-08-24

- Recovered task import from discovered source cards instead of requiring an already materialized ledger ([4c9519b70](https://github.com/eaglhuang/AI-Atomic-Framework/commit/4c9519b70)).

#### 2026-08-23

- Automatically handed off concurrent close windows and bound runner takeover to its exact physical dirty-file scope ([9c99b2ad0](https://github.com/eaglhuang/AI-Atomic-Framework/commit/9c99b2ad0), [5354cebca](https://github.com/eaglhuang/AI-Atomic-Framework/commit/5354cebca)).

#### 2026-08-22

- Enforced proven hard-causal task dependencies at import and claim, rather than treating all declared relationships as execution blockers ([da019ca48](https://github.com/eaglhuang/AI-Atomic-Framework/commit/da019ca48), [0cdbc9e95](https://github.com/eaglhuang/AI-Atomic-Framework/commit/0cdbc9e95)).

#### 2026-08-21

- Sealed the skill source universe and projection parity; isolated validator commands from the caller's lane session ([603ad3514](https://github.com/eaglhuang/AI-Atomic-Framework/commit/603ad3514), [7c352a457](https://github.com/eaglhuang/AI-Atomic-Framework/commit/7c352a457)).

#### 2026-08-20

- Stabilized immutable wave-observer receipt inputs and stopped obsolete observer successors from invalidating current evidence ([59eb2efd0](https://github.com/eaglhuang/AI-Atomic-Framework/commit/59eb2efd0), [8bebdb200](https://github.com/eaglhuang/AI-Atomic-Framework/commit/8bebdb200)).

#### 2026-08-19

- Kept the live Git index at HEAD after governed commits and recovered ancestor-owned residue without rewriting later paths ([a8bbf3ad0](https://github.com/eaglhuang/AI-Atomic-Framework/commit/a8bbf3ad0), [2f8322cad](https://github.com/eaglhuang/AI-Atomic-Framework/commit/2f8322cad)).

#### 2026-08-18

- Repaired stale-evidence recovery, environment-prefixed validator formatting, and the bridge from verified published-runner receipts ([aa5d12ba5](https://github.com/eaglhuang/AI-Atomic-Framework/commit/aa5d12ba5), [8a2d9f126](https://github.com/eaglhuang/AI-Atomic-Framework/commit/8a2d9f126)).

#### 2026-08-16

- Sealed skill projection parity and stopped independent evidence certificates from invalidating themselves on remote fast-forward ([81712257a](https://github.com/eaglhuang/AI-Atomic-Framework/commit/81712257a), [a83803554](https://github.com/eaglhuang/AI-Atomic-Framework/commit/a83803554)).

#### 2026-08-15

- Resolved terminal-history ownership through canonical authority snapshots and retained durable lane ownership on framework claims ([1bea12f10](https://github.com/eaglhuang/AI-Atomic-Framework/commit/1bea12f10), [8c6916a2f](https://github.com/eaglhuang/AI-Atomic-Framework/commit/8c6916a2f)).

#### 2026-08-14

- Resealed work-admission tickets atomically on scope amendments; preserved declared validator commands and failed closed on undeliverable skill source templates ([60e4daba4](https://github.com/eaglhuang/AI-Atomic-Framework/commit/60e4daba4), [82f17c1ad](https://github.com/eaglhuang/AI-Atomic-Framework/commit/82f17c1ad), [1b58c4a2d](https://github.com/eaglhuang/AI-Atomic-Framework/commit/1b58c4a2d)).

#### 2026-08-13

- Applied real unified patches in the neutral steward and grounded four-plan certificate judgments in observed evidence and live remote state ([8cef64b8f](https://github.com/eaglhuang/AI-Atomic-Framework/commit/8cef64b8f), [f8f7789a3](https://github.com/eaglhuang/AI-Atomic-Framework/commit/f8f7789a3)).

#### 2026-08-12

- Added independent four-plan certificate and shadow-comparison surfaces, including explicit hostile-dogfood and closeout observations; these are evidence mechanisms, not a new public version ([a1d0306a0](https://github.com/eaglhuang/AI-Atomic-Framework/commit/a1d0306a0), [169f13033](https://github.com/eaglhuang/AI-Atomic-Framework/commit/169f13033)).

#### 2026-08-11

- Preserved released-index residue through close and coordinated close with sealed-runner publication ([703b451d9](https://github.com/eaglhuang/AI-Atomic-Framework/commit/703b451d9), [3985b713d](https://github.com/eaglhuang/AI-Atomic-Framework/commit/3985b713d)).

#### 2026-08-10

- Made publication handoff atomic and distinguished terminal ownership from live residue ownership ([264ad16e6](https://github.com/eaglhuang/AI-Atomic-Framework/commit/264ad16e6), [97037d7af](https://github.com/eaglhuang/AI-Atomic-Framework/commit/97037d7af)).

#### 2026-08-09

- Preserved publication transaction evidence and made release recovery fail closed ([7b7c625ff](https://github.com/eaglhuang/AI-Atomic-Framework/commit/7b7c625ff), [0d3839c9b](https://github.com/eaglhuang/AI-Atomic-Framework/commit/0d3839c9b)).

#### 2026-08-08

- Added sandboxed test-patch proposals and evidence freshness certificates ([bdc02704a](https://github.com/eaglhuang/AI-Atomic-Framework/commit/bdc02704a), [ab501515c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ab501515c)).

#### 2026-07-31

- Added coverage-universe compilation, a QualityGauntlet facade, and closure-assurance reduction, with mutation-adapter lineage and equivalence governance ([d1a1f2bee](https://github.com/eaglhuang/AI-Atomic-Framework/commit/d1a1f2bee), [27d63f7d7](https://github.com/eaglhuang/AI-Atomic-Framework/commit/27d63f7d7), [b31579017](https://github.com/eaglhuang/AI-Atomic-Framework/commit/b31579017)).

#### 2026-07-30

- Added incremental evidence-freshness rerun plans, data-driven skill distribution profiles, and editor-global overlays ([d939ece33](https://github.com/eaglhuang/AI-Atomic-Framework/commit/d939ece33), [68374405e](https://github.com/eaglhuang/AI-Atomic-Framework/commit/68374405e), [8a289b8db](https://github.com/eaglhuang/AI-Atomic-Framework/commit/8a289b8db)).

#### 2026-07-29

- Added independent acceptance-evidence close gates and final verdict aggregation rather than treating task status alone as delivery proof ([56a506b3e](https://github.com/eaglhuang/AI-Atomic-Framework/commit/56a506b3e), [ccb5413e4](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ccb5413e4)).

#### 2026-07-28

- Bound historical admission attestation to immutable provenance and reconciled stale publication receipts ([91fcf80a5](https://github.com/eaglhuang/AI-Atomic-Framework/commit/91fcf80a5), [052bebb10](https://github.com/eaglhuang/AI-Atomic-Framework/commit/052bebb10), [1f566b660](https://github.com/eaglhuang/AI-Atomic-Framework/commit/1f566b660)).

#### 2026-07-27

- Added historical-runner red/green discrimination and autonomous review lifecycle recovery ([9faccadbd](https://github.com/eaglhuang/AI-Atomic-Framework/commit/9faccadbd), [a58b814fa](https://github.com/eaglhuang/AI-Atomic-Framework/commit/a58b814fa)).

#### 2026-07-26

- Added causal validator selection and phase-suite promotion gating so task evidence and broader phase coverage use one contract ([c778a76b8](https://github.com/eaglhuang/AI-Atomic-Framework/commit/c778a76b8)).

#### 2026-07-25

- Added structured execution receipts and a zero-test hard gate, plus migration of causal validator execution contracts ([6ea33fd4a](https://github.com/eaglhuang/AI-Atomic-Framework/commit/6ea33fd4a), [6dea40d8b](https://github.com/eaglhuang/AI-Atomic-Framework/commit/6dea40d8b)).

#### 2026-07-24

- Added causal task-authoring, progressive-disclosure skill definitions, and provider support for deep module refactoring ([d3312405e](https://github.com/eaglhuang/AI-Atomic-Framework/commit/d3312405e), [e8d9226a3](https://github.com/eaglhuang/AI-Atomic-Framework/commit/e8d9226a3), [d8fee0a3e](https://github.com/eaglhuang/AI-Atomic-Framework/commit/d8fee0a3e)).

#### 2026-07-23

- Added receipt-bound shared-write admission, steward-only delivery, transactional patch materialization, and post-compose semantic gates ([c979427a2](https://github.com/eaglhuang/AI-Atomic-Framework/commit/c979427a2), [35a08fc6b](https://github.com/eaglhuang/AI-Atomic-Framework/commit/35a08fc6b)).

#### 2026-07-22

- Added acceptance-evidence realness contracts, content-sealed runner parity, and staged-candidate line-budget checks ([eb397c3d4](https://github.com/eaglhuang/AI-Atomic-Framework/commit/eb397c3d4), [b3ab50a2c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/b3ab50a2c), [957a333fb](https://github.com/eaglhuang/AI-Atomic-Framework/commit/957a333fb)).

#### 2026-07-21

- Exposed broker replay evidence and required real dogfood lifecycle observations; isolated parallel validator failure diagnostics ([c29341677](https://github.com/eaglhuang/AI-Atomic-Framework/commit/c29341677), [59a448617](https://github.com/eaglhuang/AI-Atomic-Framework/commit/59a448617), [df793f300](https://github.com/eaglhuang/AI-Atomic-Framework/commit/df793f300)).

#### 2026-07-20

- Sealed canonical telemetry summaries and provided a bounded temporary framework-claim skill route ([aa0a88e92](https://github.com/eaglhuang/AI-Atomic-Framework/commit/aa0a88e92), [cbbe4d868](https://github.com/eaglhuang/AI-Atomic-Framework/commit/cbbe4d868)).

#### 2026-07-19

- Added atomic wave-checkpoint receipts, gate-coverage preflight, and canonical task-ID import boundaries ([408315750](https://github.com/eaglhuang/AI-Atomic-Framework/commit/408315750), [0f24213f6](https://github.com/eaglhuang/AI-Atomic-Framework/commit/0f24213f6), [f9d96a28c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/f9d96a28c)).

#### 2026-07-18

- Added executor-neutral wave runtime and lane-aware same-task claim/adoption handling ([ed3de81e0](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ed3de81e0), [8ec46699b](https://github.com/eaglhuang/AI-Atomic-Framework/commit/8ec46699b)).

#### 2026-07-17

- Removed concrete planning-repository names from adapters and repaired the memory-consolidation skill source ([f0de9a493](https://github.com/eaglhuang/AI-Atomic-Framework/commit/f0de9a493), [4ece6cc10](https://github.com/eaglhuang/AI-Atomic-Framework/commit/4ece6cc10)).

#### 2026-07-16

- Added explicit lane adoption and released orphan runner-sync queue heads, keeping unrelated preparation outside shared build ownership ([eef10bf71](https://github.com/eaglhuang/AI-Atomic-Framework/commit/eef10bf71), [9c3d80cec](https://github.com/eaglhuang/AI-Atomic-Framework/commit/9c3d80cec)).

#### 2026-07-15

- Added generated-projection and runner-sync steward queues to coordinate shared output publication ([08484f35e](https://github.com/eaglhuang/AI-Atomic-Framework/commit/08484f35e), [216315cf1](https://github.com/eaglhuang/AI-Atomic-Framework/commit/216315cf1)).

#### 2026-07-14

- Allowed historical delivery references to name the actual delivery repository during cross-repository reconciliation ([cbf8a0aaf](https://github.com/eaglhuang/AI-Atomic-Framework/commit/cbf8a0aaf)).

#### 2026-07-13

- Added runtime-residue reconciliation and historical batch-checkpoint closeback, distinguishing temporary artifacts from user work ([649be4a8f](https://github.com/eaglhuang/AI-Atomic-Framework/commit/649be4a8f), [6e7514313](https://github.com/eaglhuang/AI-Atomic-Framework/commit/6e7514313), [9e752e1ff](https://github.com/eaglhuang/AI-Atomic-Framework/commit/9e752e1ff)).

#### 2026-07-12

- Drove closure readiness from the write-side validator set and reconciled failed-commit evidence ([4fbf35c32](https://github.com/eaglhuang/AI-Atomic-Framework/commit/4fbf35c32), [573ac3cf7](https://github.com/eaglhuang/AI-Atomic-Framework/commit/573ac3cf7)).

#### 2026-07-11

- Added governed Team handoff ledgers and repaired stale direction-lock release while honoring claim globs for generated mirrors ([16215e90c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/16215e90c), [d67fa47d8](https://github.com/eaglhuang/AI-Atomic-Framework/commit/d67fa47d8), [322b02cd2](https://github.com/eaglhuang/AI-Atomic-Framework/commit/322b02cd2)).

#### 2026-07-10

- Added provider-neutral role skill-pack manifests, integration runtime capabilities, and OpenAI-family runtime bridges ([beeb0da75](https://github.com/eaglhuang/AI-Atomic-Framework/commit/beeb0da75), [d45abbfb0](https://github.com/eaglhuang/AI-Atomic-Framework/commit/d45abbfb0), [e540beb98](https://github.com/eaglhuang/AI-Atomic-Framework/commit/e540beb98)).

#### 2026-07-09

- Fenced protected staged ATM history and finalized diagnostic historical-batch evidence ([39c5223a6](https://github.com/eaglhuang/AI-Atomic-Framework/commit/39c5223a6), [e6f73063b](https://github.com/eaglhuang/AI-Atomic-Framework/commit/e6f73063b)).

#### 2026-07-08

- Compacted `next` output, quieted successful validators, and repaired batch routing and interrupted-close residue handling ([3195d5a5a](https://github.com/eaglhuang/AI-Atomic-Framework/commit/3195d5a5a), [31f36d7b0](https://github.com/eaglhuang/AI-Atomic-Framework/commit/31f36d7b0)).

#### 2026-07-07

- Retired the legacy `do` command, exposed broker register-mismatch details, and removed a blocking advisory from pre-commit ([1d494571a](https://github.com/eaglhuang/AI-Atomic-Framework/commit/1d494571a), [d18a527f8](https://github.com/eaglhuang/AI-Atomic-Framework/commit/d18a527f8), [ec324d3c0](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ec324d3c0)).

#### 2026-07-06

- Made onefile-budget fixtures mirror the real payload boundary so retained release output cannot trigger recursive self-spawn ([3ef6a21ab](https://github.com/eaglhuang/AI-Atomic-Framework/commit/3ef6a21ab)).

#### 2026-07-03

- Excluded `release/**` from the onefile payload to stop nested-launcher recursion ([286e0cdb0](https://github.com/eaglhuang/AI-Atomic-Framework/commit/286e0cdb0)).

#### 2026-07-02

- Surfaced stale claims and framework locks as audit findings and updated official arXiv links ([8491ed6ea](https://github.com/eaglhuang/AI-Atomic-Framework/commit/8491ed6ea), [16c42db33](https://github.com/eaglhuang/AI-Atomic-Framework/commit/16c42db33)).

#### 2026-07-01

- Repaired auto-evidence mapping, reset-open classification, and broker/CID parity; hardened clean-checkout validator runners ([8f8ce1f68](https://github.com/eaglhuang/AI-Atomic-Framework/commit/8f8ce1f68), [867c8a4ae](https://github.com/eaglhuang/AI-Atomic-Framework/commit/867c8a4ae)).

#### 2026-06-30

- Made skill-companion enumeration deterministic and stabilized validator reruns against host-path drift ([1f8628dfb](https://github.com/eaglhuang/AI-Atomic-Framework/commit/1f8628dfb), [3800c6554](https://github.com/eaglhuang/AI-Atomic-Framework/commit/3800c6554)).

#### 2026-06-29

- Added the unified test-catalog bridge, prepared task-scoped commit evidence before push, and hardened fresh-clone validator portability ([ecbff0fad](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ecbff0fad), [0e9641b40](https://github.com/eaglhuang/AI-Atomic-Framework/commit/0e9641b40), [8dc8b5d46](https://github.com/eaglhuang/AI-Atomic-Framework/commit/8dc8b5d46)).

#### 2026-06-28

- Added paper quick-verify docs and isolated `validate:cli` onboarding
  fixture resolution.
- Sanitized repo-selection environment handling across ATM wrapper and
  hook paths.
- Merged the paper evidence fast path into `main`.
- Shipped the identity / hook / validator / skill-template repair lane:
  explicit actor governance, `identity clear`, per-actor identity
  lookup, editor mismatch checks, pre-push worktree-local git-head
  evidence visibility, non-critical git-head scope narrowing, shared
  validator fixture contracts, and validator duration budget reporting.
- Published fast-path verification and containment evidence and synced
  backlog / handoff governance records for the repair lane.
- Repaired prompt guidance and scoped git lanes, then backfilled the
  matching governance repair git-head evidence.

#### 2026-06-27

- Added ATM OperationalBench public benchmark plus supplementary
  evidence bundles.
- Parameterized repo-local broker evidence path defaults and added
  regression coverage.
- Narrowed completion-report markdown detection to reduce false
  governance blocks.
- Integrated the SKL team-growth line into the framework main route.
- Added structured artifact admission evidence and synchronized the
  release-side completion detector narrowing.

#### 2026-06-25

- Added CI framework-claim preflight for required release gates.
- Built and published ATM AdmissionBench v0.1 / v0.2 source and
  evidence chains.
- Fixed auto-matrix workflow YAML quoting and refreshed git-head
  evidence around the release rerun lane.
- Tracked Claude Code sandbox self-host templates for self-hosted
  agent-pack installs.

#### 2026-06-24

- Completed the SKL tool-first bridge fields and runtime pilot.
- Recorded SKL governance artifacts, closure evidence, and mirrored
  runtime/schema outputs.
- Linked the frozen-runner build lesson back into SKL runtime evidence
  so the skill-growth layer captures the dogfood path.

## [0.9.0] — 2026-06-23 (historical paper-aligned development milestone)

Historical development summary for the arXiv preprint
*"ATM: Adapter-Guided Atomization with CID Broker for Single-Domain
Multi-Vendor LLM Code Co-Synthesis"*. The original June 23 milestone
was later published as the paper snapshot `v0.9.0-alpha.1` on June 24;
see the date and version conventions above. The following claims and
limitations are retained as the historical snapshot description.

Scope of this release: single-workspace / single-filesystem-domain
pre-write admission control for multi-agent LLM code synthesis.
Cross-machine / cross-clone Git PR resolution is explicitly out of
scope and remains delegated to Git's three-way merge and human review.

### Added — admission core

- **Two-tier Contract Identifier (CID)** — candidate CID (metadata
  fingerprint) and capsule CID (content-addressed) for cross-process
  atom identity (`packages/core/src/registry/`, `packages/core/src/broker/candidate-bridge.ts`).
- **Seven-layer hard gate** — CID identity → shared surface →
  read/write set → file range / AGR → ConflictKey + canMerge →
  CAS base-hash → fallback file lock
  (`packages/core/src/broker/decision.ts`,
  `conflict-matrix.ts`, `policy.ts`).
- **Augmented Decision Rule** — read/write-set intersection check at
  admission time (TASK-CID-0032).
- **CAS base-hash guarded apply** — bounded one-shot re-plan on hash
  mismatch (`packages/core/src/broker/cas.ts`, Definition 6 in paper).
- **Neutral steward arbitration flow** — four-verdict (apply /
  merge-required / blocked / human-required) fail-closed gate
  (TASK-MAO-0009, `packages/core/src/broker/steward.ts`).

### Added — Adaptive Granularity Refinement (AGR)

- **AGR Layer 1: Syntactic Enclosure Atomization** — purely structural
  refinement, no LLM call
  (`packages/core/src/broker/agr.ts`, TASK-CID-0029).
- **AGR Layer 2: Signature-Preserving Decomposition** — θ_count /
  θ_density threshold-bounded decomposition for hunk-level conflicts
  (`packages/core/src/broker/policy.ts`, TASK-CID-0031).
- **Symbol Canonicalization Policy** — per-adapter deterministic
  `canon_sym` mapping for stable CID across renames / namespaces
  (TASK-CID-0033).
- **Adapter Planning SDK** — `discoverAtomCandidates`,
  `EnclosingUnit`, `VirtualAtom` contracts
  (`packages/plugin-sdk/src/atomization-planning.ts`,
  TASK-ASP-0001 ~ 0005).

### Added — Format-agnostic generalization

- **Format adapter subsystem** — file-mutation adapter registry plus
  five shipped adapters: `json-record`, `text-range`,
  `numeric-scalar` (commutative-merge), `atom-map` (domain),
  `fallback-file-lock`
  (`packages/core/src/broker/adapters/`,
  TASK-CID-0091 ~ TASK-CID-0098).
- **Batch planner and content-addressed CAS** —
  `batch-planner.ts`, `cas.ts`.
- **ConflictKey taxonomy** — `(scope, locator)` pair across `file` /
  `record` / `range` / `line` / `scalar` / `semantic` scopes
  (Theorem 3 in paper).

### Added — Multi-Agent Orchestration (MAO) and Team Agents Wave Mode

- **MAO Route Context state machine** — `open → admitted → frozen →
  waiting → blocked → ready-to-apply → closed/abandoned`
  (TASK-MAO-0001 ~ 0003).
- **Freeze / patch-envelope / conflict-matrix snapshot protocol** —
  crash-safe arbitration with WIP capture
  (`packages/core/src/broker/freeze.ts`, `patch-envelope.ts`,
  `conflict-matrix.ts`, TASK-CID-0040 / 0041).
- **MAO parallel routing benchmark** — 12 scenarios, full hazard-catch coverage
  (8/8 unsafe), 0 false-safe, 0 expectation failures
  (TASK-MAO-0010, `docs/reports/mao-parallel-routing-benchmark.md`).
- **Team Agents Wave Mode** — batch admission for related task cards
  with coordinator-only lifecycle authority
  (TASK-MAO-0023 ~ 0034); 5/5 dogfood scenarios passing
  (`docs/reports/team-wave-mode-dogfood.md`).
- **External / runner-broker pipelines** — runner submit-patch,
  runner-ref publish, broker bootstrap recovery, external core
  contributor pipeline (TASK-MAO-0014 ~ 0022).

### Added — Git Boundary Admission Bridge (Topology C)

- **`atm git admit` CLI** — pre-push admission entry point reusing
  the broker / format-adapter / composer / steward pipeline
  (TASK-GIT-0001 ~ TASK-GIT-0012 delivered across the 2026-06-23 release wave).
- **Pre-push Git hook** — invokes `atm git admit` against
  `git merge-base HEAD origin/<branch>`, builds local and remote
  mutation requests, and either allows the push, blocks with
  reviewable evidence, or routes through deterministic composer.
- **Push-fail fallback** — same admission path runnable post-fail.
- **Steward dry-run / apply** — write-back to working tree without
  auto-commit by default.
- **Paper-ready evidence harness** — git-boundary fixture coverage
  feeding paper §6.4.3 / Appendix A.4.
- Out of scope for MVP: per-commit gate, background daemon, cross-
  machine broker RPC, full auto-rebase engine, auto-commit-on-apply,
  cross-machine PR race resolution.

### Added — Refinement loop (🔶 dogfood-backed prototype)

- Structured **split suggestion** generated on
  `blocked-cid-conflict`, promoted to **curator patch draft**, and
  queued for **human-reviewable approval** with approve-decision
  trace.
- Same-owner bounded atom dogfood case as backing evidence
  (TASK-TEAM-BROKER-HOT-FIRST / -DISJOINT,
  `docs/reports/same-owner-bounded-atom-dogfood/`).

### Added — Field evidence and adoption

- **POS2 cross-vendor same-file end-to-end merge** —
  `codex-gpt54mini` vs `claude-opus47` on
  `packages/cli/src/commands/broker.ts`,
  bounded regions `841-878` and `989-1142`, baseCommit
  `51dd72a70c835cad57786607fe7ad733655286d0`,
  merge plan `merge-255c73707a528edc`, steward verdict `applied`,
  validator pass.
- **close-orchestration field outcome** — live multi-vendor
  same-file different-function admission case.
- **B-12 controlled field collision** — cross-vendor late-enforcement
  case (admission `parallel-safe`, apply-phase fail-closed at
  active-intent contention).
- **npc-brain three-week adoption study** — 37 atomization task
  cards, 0 unrecovered admission errors, honest narrative of one
  10-card scope-lock contention burst with ledger-replay recovery.
- **Self-hosting forensics** — TASK-CID-0040 ~ TASK-CID-0045
  incident series and reconciliation packets feeding paper §4.2.

### Added — Validation harnesses

- **12-scenario AGR fixture suite** (`scripts/validate-agr-benchmark.ts`,
  TASK-CID-0037).
- **5-scenario format-adapter dogfood** with `SHIP` recommendation
  (`packages/core/src/broker/__tests__/dogfood-adapter-benchmark.test.ts`).
- **Team Wave Mode dogfood**
  (`scripts/validate-team-wave-mode.ts`, 5/5 scenarios).
- **MAO parallel routing benchmark**
  (`scripts/validate-mao-parallel-routing.ts`,
  12 scenarios, full hazard-catch coverage).
- **CID stability validator**
  (`scripts/validate-atom-id-to-cid.ts`).

### Known limitations (carried forward into v1.0 backlog)

- Cross-language atom identity (across regimes) remains an open
  problem (paper §3.9).
- CID schema migration paths (flag-day vs dual-read vs compatibility
  map) deliberated but not finalized (paper Appendix A.3).
- Comparative throughput benchmarks against STORM / CodeCRDT / SCF
  are deferred to the December 2026 full paper (paper §5).
- Topology B (shared-server multi-vendor deployment) and Topology D
  (distributed broker over network) are documented as deployment
  vision but not engineered in this release (paper §6.4.2 / §6.4.5).

### Reproducibility

Reviewers can map every ✅ claim in the accompanying paper to source
location and verification command via paper Appendix A.4. The
companion evidence repository at
`https://github.com/eaglhuang/3KLife` (`docs/ai_atomic_framework/`)
holds frozen artifact snapshots tagged `v0.9.0-paper`.

### Daily log

#### 2026-06-23

- Locked Git Boundary Admission contract and delivered TASK-GIT-0002~0012: admission CLI, pre-push hook scaffolding, push-fail fallback, steward dry-run/apply, paper-ready evidence harness.
- Archived TASK-PAPER-HOTFILE-BLOCK-A/B ledgers, closed governance + release sync, wired shared skill growth contracts.

#### 2026-06-22

- Delivered TASK-CID-0117~0119 live apply evidence and adoption gate, plus TASK-PAPER-HOTFILE-POS2-A cross-vendor merge.
- Added structured split suggestions, curator bridge to patch drafts, reviewer queue, and same-owner bounded merge outcome.
- Packaged same-owner bounded atom paper evidence bundle and preserved proposal admission + rearbitration evidence.

#### 2026-06-21

- Delivered TASK-CID-0115 proposal admission runtime, TASK-CID-0116 closeout, pre-patch merge candidate scanner.
- Captured team-run brokerLane evidence and synced proposal admission schemas + validator.

#### 2026-06-20

- Completed TASK-AAO-0145 governance, residue auto-clean for git-governance / runtime / scoped commit lanes.
- Closed TASK-AAO-0078 / 0103 / 0109 / 0115 / 0042 / 0043 / 0044 (with stage-only completion variant), TASK-RFT-0009, TASK-AAO-0146 runner arbitration + claim intent fix.
- Added broker evidence capture / collection tooling for paper plan, chinese mojibake cleaner training workflow, TASK-TEAM-0037~0041 emergency vendor runtime bundle.

#### 2026-06-19

- Delivered TASK-TEAM-0018 lease fencing diagnostics and TASK-TEAM-0019 / 0031~0036: runtime mode adapter, editor subagent bridge, rework route state machine, artifact handoff retry, nodejs worker adapter, sandbox attestation closure, polyglot worker examples.
- Added broker transactions schema, serialized commit lane, steward apply evidence, patrol broker gates, broker subagent contract + governance.
- Closed TASK-AAO-0110 / 0112 / 0113 / 0122 / 0123 / 0126 / 0127 / 0129 / 0135 / 0136 / 0137, TASK-CID-0113 / 0114, stale lease epoch close gate fix.

#### 2026-06-18

- Delivered the runner-broker pipeline series: TASK-MAO-0014 runner-ref publish, TASK-MAO-0016 submit-patch, TASK-MAO-0017 version stream, TASK-MAO-0018 closure packet binding, TASK-MAO-0019 cross-repo dual-binding, TASK-MAO-0020 broker bootstrap recovery, TASK-MAO-0021 failure-mode coverage, TASK-MAO-0022 external core contributor pipeline.
- Delivered TASK-MAO-0043~0048 / 0053~0058 (repair-claim, knowledge boundary, closeback runbook, knowledge cache fencing, build query dry-run, preflight summaries, retention budget, opt-in rerank, patrol report).
- Delivered TASK-AAO-0142 auto-run declared validators, TASK-AAO-0143 close absorbs regenerable artifacts, TASK-AAO-0144 governed git entrypoint + build output hygiene.
- Closed TASK-CID-0091~0097 format adapter governance bundle.

#### 2026-06-17

- Delivered the full **Team Agents Wave Mode v1** series TASK-MAO-0023~0034: architecture contract, candidate planner + `team wave` CLI, Wave Envelope schema, broker admission, runtime record + dispatch + validator, worker report contract, per-task evidence slicing, partial-completion checkpoint, coordinator-only closeout guard, validator/reviewer roles, dogfood benchmark, operator guide.
- Delivered TASK-MAO-0036 / 0038 / 0049 (closeback orchestration route correctness, repair-closure guards, scope add audit lane), TASK-MAO-0039~0042 / 0050~0052.
- Delivered TASK-MAO-0015 patch envelope ATM core specialization; fixed import scanner lookalike handling.

#### 2026-06-16

- Delivered **format-adapter subsystem**: mutation adapter registry plus JSON / text / numeric format adapters and the atom-map domain adapter (TASK-CID-0091~0098).
- Delivered batch planner + content-addressed CAS, dogfood gate, atomization receipts, historical batch envelope MVP.
- Delivered TASK-MAO-0009 steward arbitration flow, TASK-MAO-0010 parallel routing benchmark (12 scenarios, full hazard-catch coverage), TASK-MAO-0004 next route + task selector with fresh evidence, TASK-MAO-0007 / 0008 / 0035 closebacks, TASK-CID-0099~0111 governance bundles, broker neutrality fix (adopter path to config).

---

## [0.8.0] — 2026-06-15 (AGR + MAO Route Context + Team Agents v1)

Bridge release between brokered-write foundation (v0.7.0) and the
paper-aligned format-adapter wave (v0.9.0). Introduces AGR layer 1/2,
freeze + patch envelope snapshot protocol, MAO Route Context state
machine + lifecycle CLI, conflict-set matrix arbitration, runner
reproducible-build gate, and the first Team Agents template /
patrol / planner contracts.

### 2026-06-15

- Delivered TASK-TEAM-0015~0016 task recommendation surface and team start delivery, plus TASK-TEAM-0029 team-start claim gate parity.
- Added the repo-aware bug backlog router skill and team lease target-path normalization.
- Reconciled TASK-MAO-0005~0006 closebacks and the TASK-AAO-0118 import/release cycle.

### 2026-06-14

- Delivered MAO logical routing foundation: TASK-MAO-0001 logical routing contract, TASK-MAO-0002 route context contract, TASK-MAO-0003 route lifecycle CLI.
- Delivered runner build hardening: TASK-MAO-0011 reproducible build gate, TASK-MAO-0012 build scope manifest, TASK-MAO-0013 atm core scope classifier.
- Delivered TEAM-0004~0006 templates and patrol surfaces, plus TASK-RFT-0003 framework-development facade extraction and TASK-RFT-0008 commit message strategy map.
- Delivered TASK-TEAM-0009~0013 plan resolver, role selector, start status runtime, permission lease validator, file write scope validator.
- Closed TASK-CID-0077~0090 closeout governance bundle and TASK-CID-0089 doctor integration drift remediation.

### 2026-06-13

- Hardened dual-repo close bundle and added the planning-authority closeback delivery path.
- Added TASK-CID-0065 emergency backend approval lane, TASK-CID-0066 new user workflow guide, and the `atm-atom-map-refactor` skill.
- Closed TASK-CID-0043~0076 governance bundles, extracted closeout provenance atom and dependency gate atom, normalized `writeReadinessHint` operator/backend guidance (TASK-CID-0073).

### 2026-06-12

- Delivered AGR core: TASK-CID-0033 adapter AGR contracts, TASK-CID-0035 AGR steward runtime, TASK-CID-0037 12-scenario AGR benchmark harness.
- Delivered TASK-CID-0040 freeze + patch envelope snapshot protocol, TASK-CID-0041 conflict-set matrix arbitration, TASK-CID-0044 recovery + orphan cleanup, TASK-CID-0045 AGR conflict benchmark harness.
- Added broker `route` command for steward takeover and validator-gated apply.
- Delivered TASK-CID-0050 tasks atomic map + invariant inventory, TASK-CID-0061 stabilized public surface contract, TASK-CID-0064 closure packet recovery.

### 2026-06-11

- Added broker-owned write actor boundary and closeout-only claim intent CLI aliases.
- Delivered TASK-AAO-0139 task-id casing governance, TASK-AAO-0140 closeback orchestration, TASK-AAO-0141 delivery.
- Delivered TASK-CID-0032 read-set broker decision contract, TASK-CID-0034 AGR runtime registry, TASK-CID-0036 AGR closeout validator.
- Refined atom CID semantics and validation; fixed CLI lazy-load to break import cycles and prevented pre-tool stdin hang.

### 2026-06-10

- Delivered AGR atomization-planning SDK series: TASK-ASP-0001 AtomizationPlanningAdapter contract, TASK-ASP-0002 scanner-based atom candidate discovery, TASK-ASP-0003 python adapter promotion, TASK-ASP-0004 candidate-to-WriteIntent bridge with deterministic atomCid, TASK-ASP-0005 closeout.
- Delivered TASK-AAO-0138 formal opener and residue finalization UX, TASK-APO-0030 python language adapter plugin.
- Honored close commit window for closure packets, relaxed claim blockers, auto-imported taskflow cards.

---

## [0.7.0] — 2026-06-09 (Brokered-write foundation + neutral steward)

First brokered-write lifecycle release: TASK-CID-0017~0024 broker
proposal runtime, neutral write steward, parallel advisor + validator
paths, captain ergonomics, and write-path atomicity. Foundational
work that the AGR layers (v0.8.0) and format adapters (v0.9.0) build
on.

### 2026-06-09

- Added protected-branch and current-head git-head evidence backfills, plus frozen runner artifact sync.
- Delivered TASK-AAO-0135~0137 brokered-write and captain ergonomics work, including acceptance harnesses and write-path atomicity.
- Continued TASK-CID-0020~0023 ledger persistence and evidence refresh work across brokered-write, team, and historical-close flows.

## 2026-06-08

- Completed TASK-CID-0019~0022 broker lifecycle work, including neutral write steward, team brokered-write, and lifecycle integration lanes.
- Reconciled CID ledgers, backfilled git-head evidence, and stabilized dirty-state handling for the brokered flows.
- Fixed runner entrypoint validation and removed mailbox script `ts-nocheck` debt to keep doctor and root-drop checks unblocked.

## 2026-06-07

- Added broker proposal runtime support and hardened the parallel advisor and validator paths.
- Closed TASK-CID-0017 and TASK-CID-0018 with refreshed evidence, closure metadata, and handoff capture.
- Synced release-manifest and onefile outputs for TASK-AAO-0134 while preserving the claim lifecycle artifacts.

## 2026-06-06

- Restored TASK-AAO-0063 ledger artifacts and added the historical ledger restore task card.
- Cut the framework import commit-range baseline and updated git-head / ignore rules.
- Imported the ATM framework source and release bundle while cleaning local scratch and static evidence.

## 2026-06-05

- Recovered TASK-TEAM-0002 / TASK-TEAM-0003 closure ledgers and related governance artifacts.
- Rebuilt bootstrap and git-head evidence history around the import path.
- Added taskflow dry-run reporting and completed the release-ledger backfill work.

## 2026-06-04

- Hardened TASK-AAO-0122~0128 closure packets, runner sync, and repair-context guards.
- Added the captain dispatch entry gate and enforced ATM terminology / dispatch protocol.
- Normalized task-scope path comparisons and refreshed release/license governance, including the `origin/main` merge.

## 2026-06-03

- Implemented section-aware task-card scope extraction and `outOfScope` subtraction.
- Aligned the frozen runner and release onefile for TASK-AAO-0119~0121.
- Mirrored TEAM ledger entries and repaired closure packets for TASK-AAO-0114 and TASK-AAO-0120.

---

## [0.6.0] — 2026-06-02 (Profile loader + output projections)

Adds `taskflow.profile.v1` loader contract, `actor adopt` lifecycle,
clean-checkout stable runner contract, and `--summary` / `--fields`
output projection across `next` and `tasks`. Also restores
ATM-MAP-0003 governance and completes TASK-AAO-0107~0117 batch.

### 2026-06-02

- Delivered the `taskflow.profile.v1` loader contract and de-hardcoded dry-run behavior.
- Added `actor adopt` support and restored the clean-checkout stable runner contract.
- Updated closure ledgers and fixed tracked pollution / EOF newline issues across TASK-AAO-0109~0117.

### 2026-06-01

- Recovered ATM-MAP-0003 artifacts and completed TASK-AAO-0108 recovery work.
- Completed TASK-AAO-0107 lockfile sync and related closure-state repairs.
- Improved TASK-MRP-0028 closure packet repair UX and recorded the matching ledger.

### 2026-05-31

- Finished the batch-10 leaf extraction for task-transition, git, and markdown helpers.
- Added nine unit tests and ten atom-map entries for the extraction wave.

### 2026-05-30

- Split `tasks.ts` into file-IO, parse-options, and context-map helper clusters.
- Repaired closure ledgers and rollback evidence across TASK-AAO-0081~0099.
- Synced `atm-dispatch` skills and updated dogfood / baseline governance artifacts.

### 2026-05-29

- Added `--summary` and `--fields` output projection support for `next` and `tasks`.
- Extracted route predicates, view projections, intent normalizers, and match/sort helpers from `next.ts`.
- Hardened prompt-scoped routing, claim-lock consistency, and frontmatter diagnostics.

---

## [0.5.0] — 2026-05-28 (Task lifecycle hardening + governed commit)

Adds closure-packet attestation, `tasks reconcile` and
`deliver-and-close` macro flows for historical-done tasks, governed
commit wrapper for git identity handling, batch-playbook checkpoint
states, and the atomization-wave tooling / coverage reports across
core, CLI, and seed governance.

### 2026-05-28

- Added closure-packet attestation support and delivery evidence gates.
- Delivered `tasks reconcile` and `deliver-and-close` macro flows for historical-done tasks.
- Imported target ledgers and updated CLI usage envelopes and evidence reporting.

### 2026-05-27

- Expanded batch playbook states and checkpoint flows, including queue-preview / queue-head-active / repair-required.
- Added evidence-missing, validator-list, and mirror-sync helpers for task routing and closure sync.
- Synchronized skills, prompts, and governance artifacts across the framework.

### 2026-05-26

- Added actor sessions and a governed commit wrapper for git identity handling.
- Improved taskflow, team planning, and CLI diagnostics, including checkpoint and runtime recommendation helpers.
- Completed the atomization-wave tooling and coverage reports across core, CLI, and seed governance.

### 2026-05-25

- Tightened `next` task discovery and prompt-scoped routing.
- Rewrote the `atomize` inventory / score commands and added git-head evidence backfill.
- Hardened batch checkpoints, task closure, and root-drop / onefile release validation.

### 2026-05-24

- Hardened task-claim lifecycle, closure evidence, and push-guard handling.
- Added legacy baseline cut logic and cross-repo / adopter sync protections.
- Clarified keep-file guidance and target-repo contract behavior in docs and tests.

---

## [0.4.0] — 2026-05-23 (CLI + intent routing)

Introduces prompt-scoped `next` routing, the semantic task-intent
contract, framework-development hard gates, cross-repo drift
protections, adopter sync release gates, root `node atm.mjs
--version` support, and deterministic JSON result envelope for
version output.

### 2026-05-23

- Introduced prompt-scoped `next` routing and the semantic task-intent contract.
- Added self-atomization task routing and prompt / skill updates for task selection.
- Stabilized CLI version validation and target-task authority enforcement.

### 2026-05-22

- Added framework-development hard gates and cross-repo drift protections.
- Added adopter sync release gates and allowed governed runner sync commits.
- Preserved host Copilot instructions and cleaned git-head evidence / task-lock handling.

### 2026-05-21

- Added the framework integration hook contract and task ledger governance.
- Added atomization coverage, backfill, and inventory tooling.
- Added internal release sync workflows and task/card validation gates.

### 2026-05-20

- Added root `node atm.mjs --version` support.
- Emitted a deterministic JSON result envelope for version output.
- Added CLI validation coverage and aligned the README quick reference with release artifacts.

---

### 2026-05-19

- Added the Python language adapter and task-plan import flow, with explicit python-only readiness boundaries; introduced actor identity, lease/reservation, evidence-gated close, and Git trailer contracts ([f38767070](https://github.com/eaglhuang/AI-Atomic-Framework/commit/f38767070), [ff3b5360c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ff3b5360c), [7b58305af](https://github.com/eaglhuang/AI-Atomic-Framework/commit/7b58305af), [9b83c7ee8](https://github.com/eaglhuang/AI-Atomic-Framework/commit/9b83c7ee8)).

### 2026-05-18

- Added pinned-runner bootstrap, Codex/root-entry integration, security/version-skew/known-bad-version safeguards, release trust-chain policy, and deprecation canaries ([7653816f3](https://github.com/eaglhuang/AI-Atomic-Framework/commit/7653816f3), [f844fe4eb](https://github.com/eaglhuang/AI-Atomic-Framework/commit/f844fe4eb), [c4983ec9f](https://github.com/eaglhuang/AI-Atomic-Framework/commit/c4983ec9f), [f3f904a1d](https://github.com/eaglhuang/AI-Atomic-Framework/commit/f3f904a1d)). These are implementation dates, not npm publication dates.

## [0.3.0] — 2026-05-17 (M4–M10 integration + ScopeLock 0.2.0 + replacement gating)

Single-day major release that closed M4–M10 rollout and adapter
hardening, delivered ScopeLock 0.2.0 map selectors with polymorph
impact gating, spec-based / plan-based map provisioning, and the
replacement-lane transition validation chain
(`draft → shadow → canary → active → legacy-retired`) with required
propagation / review / human-approval / rollback proof evidence.

### 2026-05-17

- Closed replacement evidence gating for M10: added `atm.propagationReport` and `atm.retirementProof`, required propagation/review/human approval before `canary -> active`, and allowed `legacy-retired` promotion through rollback proof or caller/entrypoint-cleared retirement proof.
- Added ScopeLock 0.2.0 map selectors and polymorph impact gating: `scope-lock` now round-trips `0.1.0` and `0.2.0`, `upgrade --propose --replacement-mode active` can require `--polymorph-impact-report`, and active map proposals now validate impacted instance maps for template-bound members.
- Hardened spec-based and plan-based map provisioning: `create-map --spec <path>` validates `atm.atomicMap` JSON Schema and preserves `0.2.0` replacement metadata, while `create-map --from-plan <path>` adds decomposition-plan provisioning and spec round-trip coverage.
- Added replacement-lane transition validation and map upgrade evidence gates: explicit `draft -> shadow -> canary -> active -> legacy-retired` checks, `upgrade --propose --target map` support for `--replacement-mode`, `--equivalence-report`, and `--rollback-proof`, plus blocks for active and legacy-retired proposals without the required evidence.
- Delivered M4-M10 integration rollout and adapter hardening: framework-neutral onboarding proof, agent entry skill templates, integration lifecycle CLI, map equivalence coverage, and the M5/M4 adapter contract suite for Claude Code, Copilot, Cursor, and Gemini.

---

### 2026-05-14

- Corrected error-code escaping and documented Node strip-types usage ([135be041a](https://github.com/eaglhuang/AI-Atomic-Framework/commit/135be041a)).

### 2026-05-13

- Migrated source, validators, and tests from JavaScript modules to TypeScript; added orphan-commit diagnosis and hardened cross-platform/Node 24 validation ([beebeb211](https://github.com/eaglhuang/AI-Atomic-Framework/commit/beebeb211), [dbbf75b43](https://github.com/eaglhuang/AI-Atomic-Framework/commit/dbbf75b43), [e0d33080c](https://github.com/eaglhuang/AI-Atomic-Framework/commit/e0d33080c)).

## [0.2.0] — 2026-05-12 (Portable runner + npm-first + polymorph contracts)

Delivered ATM v0.2 phase-3 portable onefile pipeline, removed
remaining `@ts-nocheck` debt across core governance flows, converged
npm-first tooling and governance entrypoints, added polymorphic
template and dimension contracts (ATM-2-0032), the non-blocking
review advisory provider flow (ATM-2-0035), case-study pilots
ATM-4-0004 / ATM-4-0008, and map evolution routing (ATM-2-0024).

### 2026-05-12

- Delivered ATM v0.2 phase-3 portable onefile pipeline.
- Removed remaining `@ts-nocheck` debt across core governance flows.
- Converged npm-first tooling and governance entrypoints.

### 2026-05-11

- Added adopter-local workbench localization migration guidance.
- Removed adopter-derived artifacts from protected upstream surfaces.
- Added polymorphic template and dimension contracts (ATM-2-0032).
- Added non-blocking review advisory provider flow (ATM-2-0035).
- Delivered case-study pilots ATM-4-0004 and ATM-4-0008.
- Implemented map evolution routing (ATM-2-0024).

### 2026-05-10

- Added inject rollback dry-run plans in case-study fixtures.

---

## [0.1.0] — 2026-05-09 (Seed governance + AtomBehavior Plugin SDK)

First governed release of the ATM seed: committed self-description
and self-verification (Phase B1), atom/map status state machine with
governance tiers (ATM-2-0027), AtomBehavior Plugin SDK with evolve
delegation guard (ATM-2-0028), atomic map provenance family
(ATM-2-0043 ~ 0046), semantic fingerprint extension (ATM-2-0026),
review gate command flow (ATM-2-0021), registry version-history
scaffolding, and the lifecycle police plugin (ATM-2-0031).

### 2026-05-09

- Added legacy dry-run adapter contract.
- Implemented lifecycle police plugin (ATM-2-0031).
- Completed consolidated behavior pack delivery (ATM-2-0029).
- Backfilled missing semantic fingerprints.
- Completed atomic map provenance family ATM-2-0043 to ATM-2-0046.
- Implemented AtomBehavior Plugin SDK with evolve delegation guard (ATM-2-0028).
- Implemented atom/map status state machine with governance tiers (ATM-2-0027).

## 2026-05-08

- Refreshed generator provenance evidence.
- Added semantic fingerprint extension (ATM-2-0026).
- Finalized review gate command flow (ATM-2-0021).

## 2026-05-07

- Added registry version-history scaffolding.
- Added `currentVersion` and `versions[]` history fields.
- Added an in-memory upcast helper plus legacy/versioned fixtures.

## 2026-05-06

- Phase B1 complete: committed self-description and self-verification landed for the seed.
- Phase B1 complete: the registry status is now governed.
- Legacy planning ID ATM-CORE-0001 remains as metadata, while ATM-CORE-0002 governs the retained hand-written seed source.

## 2026-05-05

- Created the repository baseline ([ee215122f](https://github.com/eaglhuang/AI-Atomic-Framework/commit/ee215122f)).
