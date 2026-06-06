# Experimental API Channel

ATM exposes experimental SDK APIs only behind an explicit opt-in gate. They are available for framework contributors and early adopters, but they are not stable API promises.

## Current APIs

| API | Since | Status | Opt-in |
| --- | --- | --- | --- |
| `agent-pack-preview` | `0.0.0` | experimental | `--allow-experimental` |

## Stability Promise

- Experimental APIs may change or be removed before graduation.
- CLI commands must refuse experimental invocation unless `--allow-experimental` is present.
- Welcome output may list experimental APIs, but it must not enable them by default.
- Any public use must keep the `@experimental` marker in SDK source and docs.

## Graduation Conditions

An experimental API can graduate only after:

- A bridge minor can read the old and new schema contracts.
- The API has a stable guide and fixture coverage.
- The release validator passes without an experimental opt-in path.
- The API is listed in a migration or deprecation note when behavior changes.

## CLI Example

```bash
node atm.mjs upgrade experimental-api --api agent-pack-preview --allow-experimental --json
```

The same call without `--allow-experimental` must fail with `ATM_EXPERIMENTAL_API_REQUIRES_OPT_IN`.
