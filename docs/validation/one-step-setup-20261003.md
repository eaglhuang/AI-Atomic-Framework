# ATM one-step project setup: validation summary

Validated on 2026-10-03 UTC. Implementation and local artifact validation are complete. The owner approved a public projection containing code, tests, documentation, and this deidentified validation summary. Remote publication and readback verification are separate delivery steps. No npm release or production deployment occurred.

## What changed

One command asks for the target project, discovers all matching supported configurations, safely installs and verifies selected integrations, bootstraps project-local governance, and runs welcome. Supported IDs: `claude-code`, `codex`, `copilot`, `cursor`, `gemini`, `antigravity`.

An explicit `--cwd` supports noninteractive use and sharing one external runtime across independent projects. Use `--agents <ids>` or `--agents none` when no configuration is detected. `--dry-run --json` previews without writing. Existing user content is preserved or reported as a conflict.

The installed npm CLI now provides a project launcher referencing its verified shared package entry. Package/manifest hashes establish installation consistency, not publisher authentication or immutable pinning. Keep the shared installation at a stable path. If it moves, restore that original location, or inspect and rename the generated project launcher to a retained backup before rerunning setup. Rerun alone does not automatically rebind a differing launcher.

The README retains all 24 original headings and identifies setup as an unreleased source-branch feature.

## Approved public source projection

- Base revision: `fdf7358e005a1aeaced77c20f4390b8b40079041`
- Validated implementation anchor in private local history: `b43b3eb9427b0d2ecad436b15935eda673df06d9`
- Source-only patch: 35 files, 130,890 bytes
- Patch SHA256: `07e798876217f8cd8107d9f2b155b06aba4f9577358c5f1e5ae74b08e1439d33`

The approved projection comprises 35 source/test/documentation files plus this summary. It excludes private task history, work-session records, capability identifiers, original commit trailers, and generated release mirrors. The eventual public commit has a different SHA and tree from the private validation anchor because private records are omitted and this summary is added. The private SHA is a validation reference, not a claim that the same commit is publicly reachable. The implementation-file blobs and modes must match the approved source manifest on remote readback. A separate narrow prerequisite aligns build-inventory discovery with the strict consumer; it does not relax ownership, takeover, or extra-output enforcement.

## Passed verification

### Source

```sh
node --strip-types --test tests/cli/setup-install.test.ts tests/cli/setup-detection.test.ts tests/cli/integration-safe-merge.test.ts tests/cli/public-command-registry.test.ts
node --strip-types tests/cli/runner-publication-inventory-parity.test.ts
npm run typecheck
npm run lint
npm test
```

- Combined source run: **87 passed, 0 failed** (44 setup/discovery/merge cases and 43 command-registry cases)
- Focused inventory regression passed: six CRLF/status-only paths, raw-byte identity, preservation without takeover, exact takeover, partial/broadened/stale-byte rejection, and unexpected-output rejection
- Final typecheck and lint passed
- Final standard `npm test` profile: **13 validators passed, 0 failed**, uncached, 30.517 seconds
- CLI surface, all-six integration-adapter contracts, and neutrality validation also passed during implementation

### Final artifacts

The guarded full build passed from the private implementation anchor. Its final local output-inventory check passed with zero extra outputs. The inventory migration issue was resolved through the documented cleanup and exact validation workflow, without changing enforcement. This is local build evidence, not remote publication or canonical public governance-closeout evidence.

The latest onefile was copied alone outside the repository. The latest npm tarball was installed into a new isolated consumer from the offline cache with lifecycle scripts disabled.

- **14 cold-artifact process invocations passed**: seven per artifact covering all-six setup, returned next, project-local welcome/next, repeat setup, and separate second-project setup/welcome
- **24 additional process invocations passed**: twelve per artifact covering JSON missing-target behavior, write-free dry-run, rejection of unsupported `--dry-run=true`, six adapter verifications, repeat setup, and A/B isolation
- **2 real-PTY checks passed** against the latest onefile: target prompt and successful selected-project setup; empty-answer cancellation before writes
- Assertions verified unchanged launch/home directories, stable shared-runtime bytes, and no first-project mutation from second-project setup

These are separate process checks, not additions to the 87 source-test total. Repeated earlier runs are not summed into these final counts.

## Privately validated artifact fingerprints

| Artifact | Bytes | SHA256 |
|---|---:|---|
| Onefile | 4,561,584 | `ed3a36680852930478235c138f41baa5bd5cc296e68081bba7152a64a24bc542` |
| npm runtime module | 2,439,218 | `f2f99eea8bd8510fe792c4a0041fb51f9976d20454c2dab3934d8b2bd1c62749` |
| Local npm tarball | 763,122 | `17856c8452a6a04f73cbbafa0d97d9f7aabba721f86a43063a7c42be2dd3c669` |

These fingerprints identify the locally tested build outputs; those generated artifacts are not included in this source-only public projection. Use a runner built from a revision containing setup. This export does not update npm or replace the repository’s existing frozen runner bundles.

## Limits and remaining delivery work

- The owner approved the bounded public format; remote commit creation and readback verification remain separate steps
- Canonical private governance history remains private. This projection does not claim canonical public governance closeout or identical private/public commit histories
- Native Windows/macOS execution and the separate CI CLI sweep were not performed; remote CI was not run
- Detection uses configuration paths and explicit editor environment hints; it does not establish installation, authentication, or an active agent session
- A pre-existing quoted/non-ASCII Git porcelain-path parsing limitation remains outside this candidate. The inventory fix preserves existing parsing and enforcement rather than broadening scope
- This summary is not a substitute for canonical task history or proof of public governance closeout
