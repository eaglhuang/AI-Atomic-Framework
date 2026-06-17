# CLI Error Policy

Every public ATM CLI command (`node atm.mjs <command> --json`) follows a
single, deterministic result contract. This document is the SSoT for that
contract; the runtime implementation lives in
[`packages/cli/src/commands/shared.ts`](../packages/cli/src/commands/shared.ts)
as `CliError`, `enrichCommandResult`, and `resolveCommandExitCode`.

## Output envelope

Every command emits the same top-level JSON shape. Successful and failed
commands both include the normalized result-contract fields:

```jsonc
{
  "ok": true,
  "severity": "success",
  "exitCode": 0,
  "blocking": false,
  "command": "<subcommand-name>",
  "mode": "standalone",
  "cwd": "/abs/path",
  "messages": [ /* info | warn | error entries */ ],
  "evidence": { /* command-specific payload */ },
  "diagnostics": {
    "errorCodes": [],
    "warningCodes": [],
    "infoCodes": ["ATM_CLI_HELP_READY"]
  }
}
```

When a command fails, `ok` is `false`, `blocking` is usually `true`, and at
least one `level: "error"` message is present:

```jsonc
{
  "ok": false,
  "severity": "failure",
  "exitCode": 1,
  "blocking": true,
  "command": "<subcommand-name>",
  "messages": [
    {
      "level": "error",
      "code": "ATM_<STABLE_CODE>",
      "text": "<one-line human-readable description>",
      "data": { /* optional structured details */ }
    }
  ],
  "diagnostics": {
    "errorCodes": ["ATM_<STABLE_CODE>"],
    "warningCodes": [],
    "infoCodes": []
  }
}
```

The process exit code always matches the JSON `exitCode` field.

## Severity policy

| `severity` | Meaning | Typical `ok` | Typical `exitCode` | `blocking` |
|---|---|---|---|---|
| `success` | Command completed without warnings | `true` | `0` | `false` |
| `advisory` | Command completed but surfaced warnings | `true` | `0` | `false` |
| `blocked` | Governance or lifecycle blocked the action; operator should follow `evidence.nextAction` | `false` | `1` | `true` |
| `usage-error` | Invocation was invalid | `false` | `2` | `true` |
| `failure` | Runtime, validator, or environment failure | `false` | `1` | `true` |

`advisory` exists so agents can treat warning-only success (`ok: true` with
`warn` messages) as non-blocking without guessing from exit code alone.
`blocked` separates governance-state blockers from content or validator
failures (backlog `ATM-BUG-2026-06-16-011`).

## Exit code policy

| Exit code | Meaning | When |
|---|---|---|
| `0` | success or advisory | `severity` is `success` or `advisory` |
| `1` | runtime failure or blocked action | `severity` is `failure` or `blocked` |
| `2` | **usage error** | `severity` is `usage-error`: bad CLI arguments, unknown subcommand, missing required `--flag`, action on uninitialized repo where the fix is "run the right command first" |

Other exit codes (`3+`) are reserved. Do not introduce a new exit code
without a release-train bump.

## Code policy

`code` is a stable token, `SCREAMING_SNAKE_CASE`, always prefixed with
`ATM_`. Examples:

- `ATM_CLI_USAGE` — generic usage error (exit 2).
- `ATM_CONFIG_MISSING` — `.atm/config.json` not found (exit 1 or 2 depending
  on context).
- `ATM_DOCTOR_GIT_EVIDENCE_MISSING` — doctor check failed.
- `ATM_AGENT_PACK_STALE` — installed agent pack manifest is out of date.

Codes are **part of the public CLI contract (invariant I1)**:

- Downstream automation MAY switch on the code value to decide retry / human
  escalation policy.
- Release-smoke fixtures under `tests/cli/` pin the codes that escape
  user-visible commands.
- Renaming or removing a code is a breaking change requiring a migration note
  in the release.

When introducing a new code, prefer extending an existing namespace
(`ATM_AGENT_PACK_*`, `ATM_DOCTOR_*`) over inventing a parallel one.

## Details policy

`data` (the optional payload in a message) is a plain object that callers can
inspect. Conventions:

- Keys are camelCase.
- Values must be JSON-serializable. Do not put `Error` instances, `Date`
  objects, `Buffer`, or class instances in `data`.
- Prefer **paths** as `relativePath` strings (relative to `cwd`) over
  absolute paths. The CLI uses `relativePathFrom(cwd, abs)` for this.
- Include enough information for an agent or operator to act without
  re-running the command (e.g. `{ filePath, reason }` for parse failures).

## Throwing inside command implementations

Inside a command (`packages/cli/src/commands/<command>.ts`):

```ts
import { CliError } from './shared.ts';

// Usage error: missing required flag.
if (!packId) {
  throw new CliError('ATM_CLI_USAGE', 'agent-pack install requires --pack <pack-id>', {
    exitCode: 2
  });
}

// Runtime error: schema validation failed.
if (!schemaValidator(value)) {
  throw new CliError('ATM_CONFIG_INVALID', `Invalid config at ${relativePath}`, {
    details: { relativePath, errors: schemaValidator.errors }
  });
}
```

Do **not** throw raw `Error` — the runtime envelope handler will surface it
as an opaque crash instead of a deterministic CLI error.

## Adding a release-smoke fixture for a new code

When introducing a new error code that escapes a user-visible command,
extend the relevant fixture under `tests/cli/`:

1. Add an assertion that the command produces the new code when the trigger
   condition is met.
2. Assert on the exit code as well — the (code, exitCode) pair is what
   automation depends on.
3. If the code carries structured `data`, assert on at least one stable key.

See [`docs/testing-strategy.md`](./testing-strategy.md) for the test-layer
taxonomy.
