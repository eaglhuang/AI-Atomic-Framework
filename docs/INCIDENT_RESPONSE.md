# Release Incident Response

This document defines the operational path for a published AI-Atomic-Framework release that must be blocked after publication.

## When To Add A Known-Bad Entry

Add an entry to `known-bad-versions.json` when a published ATM CLI version can cause data loss, corrupt governance state, violate licensing constraints, or ship a critical release-trust defect. Do not use this list for ordinary bugs that can be handled by a normal patch release.

Each entry must include:

- `versionRange`: exact version or simple comparator range, such as `0.3.1` or `>=0.3.1 <0.3.3`.
- `reason`: short operator-readable explanation of why the version is blocked.
- `replacementVersion`: the version users should install instead.
- `severity`: `low`, `medium`, `high`, or `critical`.
- `addedAt`: RFC3339 timestamp for the incident record.

## CLI Behavior

When the bundled CLI version matches `known-bad-versions.json`, ATM enters deny-write mode. Read-only diagnostics such as `atm doctor --known-bad --json`, `atm migrate plan`, and `atm validate` may still run so users can inspect the incident and collect support evidence. Write-oriented commands are blocked before command execution and include the replacement version plus reason summary in JSON output.

## Rollback Protocol

1. Add or update the `known-bad-versions.json` entry.
2. Run `node --experimental-strip-types scripts/validate-known-bad-versions.ts --mode validate`.
3. Publish or distribute a replacement release that bundles the updated deny-list.
4. Add the incident summary to the GitHub Release notes for both the blocked and replacement versions.
5. Keep rollback instructions focused on user workspace state. If a migration or write command may have already run, point users to the relevant migration/rollback guide instead of giving ad hoc steps.

## Relation To npm deprecate

`npm deprecate` is the public registry warning channel. The known-bad list is the CLI runtime enforcement channel. For high or critical incidents, use both: deprecate the affected npm version range with a concise warning, and ship the known-bad entry so installed CLIs can refuse write actions.

## Removal Policy

Known-bad entries are append-only during the affected release train. Do not remove an entry just because a replacement version exists. Removal requires a separate policy change and should be treated as a release governance decision.
