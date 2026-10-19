# Immutable npm release parity

ATM source `main`, packaged npm versions, root-drop and onefile distributions
may legitimately differ. An unreleased source commit is not a broken install.
Compare the executing runtime identity and exact released artifact, not just a
version copied from a target project's metadata.

## Release contract

1. Set the release versions and build the distribution once.
2. `build-release-artifacts.ts` packs only the declared CLI/starter pair with
   `--ignore-scripts`. It writes immutable `.tgz` files plus `manifest.json`
   containing package/version, source commit, public source-input digest, build
   identity, SHA-256 and SHA-512 integrity. It refuses to overwrite a prior seal.
3. The existing clean-install/adoption validator accepts `--artifact-manifest`.
   It installs those exact tarballs without rebuilding or repacking.
4. `release-candidate.ts` publishes those same files with npm provenance, public
   access and a unique candidate tag. An already-published version is reusable
   only if its downloaded bytes and identity match. Network lookup errors do not
   mean a version is absent.
5. Re-download the exact versions from the public npm registry, compare both
   hashes and embedded package/build/source identities, run the existing clean
   installation/adoption matrix, public npm proof, and public starter governed
   task lifecycle. The starter lifecycle is factored into
   `validate-public-starter.sh`; it still performs claim, scoped change, evidence,
   governed commit and close in fresh processes.
6. Recheck artifacts and target dist-tags after the lifecycle. Only then promote
   both packages to the resolved channel. Stable releases promote `latest`;
   beta/experimental/lts releases keep `latest` untouched. A dry run never claims
   a public registry proof or changes any tags.

Candidate publication is public. A candidate tag does not fully isolate a stable
semver version from consumers using version ranges. For strong prerelease
isolation, publish a prerelease version; promoting a tag never changes the
immutable version string.

## Trusted Publishing prerequisites

The workflow pins npm 11.21.0, which supports OIDC dist-tag operations. Both
packages must already allow `npm publish` and `npm dist-tag` for this exact
GitHub Actions workflow. The latter is an independent, default-off npm setting;
this implementation does not grant it or fall back to a saved token. Before
publishing either package, the runner proves add/remove access using a unique
transient preflight tag pointing to an existing version, removes the tag and
verifies removal. Failure blocks publication and retains the recovery error.
Probe package/tag/version and cleanup outcomes are journaled before each mutation.
Initial package creation without an existing version needs maintainer bootstrap.

See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/#managing-dist-tags-with-trusted-publishing).
Public tarball downloads use fresh isolated npm caches and `--prefer-online` so
locally installed candidate bytes cannot stand in for a registry download.

## Exact starter version selection

`create-atm project --tag next --cli-version 1.2.3-beta.1` installs and records
that exact CLI version with `--save-exact`. Selection priority is an explicit
`--cli-version`, an explicit `--tag`, then the starter's exact declared CLI
dependency. Source checkouts keep their local-runner behavior unless
`--cli-version` is supplied. Invalid default dependencies fail before creating
a target. Package names, paths, URLs, ranges, duplicate flags and inline
`--cli-version=value` forms are also rejected before target writes.

Explicit stable versions use `latest` or `lts`; beta prereleases use `next`,
alpha uses `beta`, and lts prereleases use `lts`. A default declared prerelease
is consumed exactly as declared. Every exact installation must match its
requested version. Candidate verification checks the resulting project runtime
identity and lockfile integrity against the release manifest.

The starter creates the initial target-local Git commit and requires an existing
Git identity. Disposable smoke fixtures provide their synthetic identity before
launching the starter, verify its initial HEAD, and continue the governed task
lifecycle from that commit.

## Runtime diagnostics

`--version --json` and `doctor --json` expose `evidence.runtimeBuildIdentity`:
execution mode, actual runtime package version, source commit/input digest,
build ID and integrity status. Resolution starts from the loaded module and
stops at the first package boundary. Target cwd, ancestor project metadata and
arbitrary environment hints cannot provide runtime facts. A packaged identity
is verified against runtime bytes. Source mode is explicitly `source-unsealed`;
missing old-release metadata is `unavailable`, and changed bytes are `mismatch`.
Runtime package facts are shared with first-run guidance through one nearest-package
resolver. An existing malformed, oversized, non-object or symlink package boundary
fails closed instead of falling through to an ancestor. Root-help resolution does
not hash runtime builds. Diagnostic member hashing accepts only regular files,
uses fixed-size reads and enforces per-file, total-byte and member-count ceilings;
FIFO, directory, oversized and concurrently changed members cannot be verified.
The existing package-metadata reader remains shallow and size-checked rather than
a filesystem-wide atomic snapshot.

The onefile `--version` and `-v` fast path verifies its compressed embedded payload
and the same distribution build identity used by doctor, entirely in memory.
It does not extract files, import the CLI, inspect ancestor metadata, or touch a
cold/warm cache or extraction lock. `runnerMode` identifies the frozen launcher;
`runtimeBuildIdentity.executionMode` describes its represented distribution.
Fixed compressed/decompressed, metadata, member-count, path-length and decoded-byte
limits bound this check. Impossible file prefixes, NUL paths and nearer package
boundaries are rejected before member verification. The package-version syntax
is shared with filesystem diagnostics. Legacy missing identity is unavailable; malformed identity or
changed members cannot return verified source fields. Payload corruption fails
before any successful version envelope is emitted.

These hashes provide consistency evidence, not an independent publisher
signature. npm provenance remains the external source/build attestation.

## Failure and recovery

The registry has no atomic two-package dist-tag transaction or conditional
compare-and-set. There is an unavoidable observation/write race and a brief
partial-promotion window. The release workflow serializes its own runs; external
publishers must coordinate separately. On partial or uncertain promotion,
reconcile only attempted tags still pointing to this candidate, restore their
observed previous values, and record any failed restoration for manual review.
Never overwrite a tag that has already moved to another version.

`proof/promotion-attempt-*.jsonl` preserves append-only per-attempt journals;
`proof/promotion.json` records the manifest digest, candidate/target tags, previous
versions, completed promotions and recovery outcome. Failed recovery remains
blocked, never successful. Preserve this receipt and tarballs as CI artifacts.
Older candidate versions cannot replace newer target tags; rollback is a separate
maintainer action. A mixed pre-existing partial promotion blocks retry until the preserved original
snapshot is reconciled by a maintainer. A retry always re-verifies public bytes and reruns the lifecycle; a saved success
receipt cannot authorize promotion. Do not repack a candidate whose version is
already public. If its bytes differ, use a new version after investigation.

No npm publish, dist-tag mutation, Git push or merge is part of local validation
of this implementation. Unit fault injection covers tampering, identity drift,
failed lifecycle, stale tags, partial/uncertain promotion and failed recovery.
Live publishing/provenance requires the release workflow and authorized npm
Trusted Publishing configuration.
