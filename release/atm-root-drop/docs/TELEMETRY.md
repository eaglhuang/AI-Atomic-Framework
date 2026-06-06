# Telemetry Policy

ATM telemetry is opt-in only. A fresh repository sends no telemetry payloads and performs no telemetry network requests.

## How to Opt In or Out

```bash
node atm.mjs telemetry --status --json
node atm.mjs telemetry --on --json
node atm.mjs telemetry --off --json
```

The setting is stored in `.atm/runtime/telemetry.json` in the adopter repository. Removing that file returns the repository to the default disabled state.

## Allowed Data Fields

Telemetry payloads are limited to these fields:

| Field | Purpose |
| --- | --- |
| `cliVersion` | understand which ATM version emitted the event |
| `nodeVersion` | identify unsupported runtime versions |
| `osFamily` | distinguish Windows, macOS, Linux, and CI behavior |
| `chartStatus` | measure supported / deprecated / unsupported chart impact |
| `commandName` | identify which ATM command was run |
| `result` | record success or fail |

ATM telemetry must not collect paths, filenames, repository names, user prompts, task titles, command arguments, environment variables, secrets, usernames, emails, or other personally identifying information.

## Use

Maintainers use opt-in aggregate telemetry to estimate deprecation blast radius, detect release regressions, and prioritize compatibility fixes. Telemetry is advisory signal only; deterministic validators and issue reports remain the blocking source of truth.

## Deletion Requests

Because the baseline payload is anonymous and does not include adopter identifiers, maintainers cannot reliably locate a single user's payload after aggregation. To stop future events, run `node atm.mjs telemetry --off --json` or delete `.atm/runtime/telemetry.json`.

If a future hosted telemetry endpoint adds an account or installation identifier, that endpoint must document a deletion request address here before launch.
