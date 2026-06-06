# Guard Engine Thin Profile

`atm guard` is designed for thin integration hooks and post-edit checks.

## Supported Guards

- `encoding`
- `mutation`
- `git`

## Fail-Open Mode

For integrations that prefer resilience over strict local blocking, use:

```bash
node atm.mjs guard mutation --task <task-id> --actor <actor-id> --files <csv> --fail-open --json
```

or:

```bash
node atm.mjs guard git --task <task-id> --actor <actor-id> --fail-open --json
```

In fail-open mode:

- command exits success (`ok=true`)
- warning message is emitted
- violations are still included in evidence payload for downstream CI or review gates

This keeps hooks lightweight while preserving full governance diagnostics.
