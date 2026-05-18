# Bridge Minor Releases

A bridge minor is mandatory before any framework major bump that removes or changes a public ATM schema contract.

## When To Cut One

Cut a bridge minor when the next major release will remove a schema field, change required semantics, stop reading a legacy artifact, or graduate an experimental API into a stable contract with changed behavior.

## Required Contents

- It can read both the old and new schema contract.
- It writes the new schema contract by default.
- It lists the future removal target in docs/DEPRECATIONS.md or the migration guide.
- It has a migration guide or explicit no-op migration note.
- It keeps write operations guarded by existing backup or explicit opt-in rules.

## Validator Behavior

`scripts/validate-bridge-minor.ts` blocks a major release fixture when no previous bridge minor is declared. The release workflow runs the validator before `validate:standard` and before publish.

A valid bridge minor record declares:

```json
{
  "previousMinor": {
    "version": "0.2.0",
    "bridgeRelease": true,
    "readsOldSchema": true,
    "writesNewSchema": true,
    "futureRemovalListed": true
  }
}
```

## Release Checklist

- Run `node --experimental-strip-types scripts/validate-bridge-minor.ts --mode validate`.
- Confirm the bridge minor can read legacy fixtures.
- Confirm the next major fixture fails when the bridge minor record is missing.
- Confirm docs/EXPERIMENTAL_API.md is updated for any experimental surface involved in the change.
