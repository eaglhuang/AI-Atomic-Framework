# ATM runtime boundary entry-reduction proof

## Scope

TASK-PRF-0062 measures the complete public CLI tarball against the fixed public
`@ai-atomic-framework/cli@0.1.0` baseline. The reduction must not remove a
required adopter workflow or rely on a workspace link.

## Design

The five schemas referenced only as ATMChart source fingerprints are now
represented by a bounded `embeddedATMChartSchemaAssets` map. It preserves each
logical path and the normalized SHA-256 digest used by chart render/verify.
Filesystem assets remain authoritative when present; the packed runtime falls
back only to an explicitly enumerated embedded asset. The atomic-spec schema
and root-drop adoption templates remain materialized because they are consumed
as runtime data by adopter commands.

The runtime manifest records every embedded logical asset as
`bundled-logical-asset` with its digest. This makes the omission auditable and
prevents an unlisted missing file from becoming a silent pass.

## Candidate evidence

The raw validator proof is retained outside Git at:

`C:\Users\User\atm-benchmark-sink\TASK-PRF-0062\candidate-proof-2026-09-14.jsonl`

The candidate was packed and installed into a temporary clean consumer. The
validator reported:

| Measure | Public 0.1.0 | Candidate | Reduction |
| --- | ---: | ---: | ---: |
| Unpacked bytes | 3,357,358 | 2,649,538 | 21.08% |
| Tarball entries | 78 | 66 | 15.38% |

Five measurement runs used Node `v24.12.0` on Windows. The clean-consumer
command matrix executed `version`, `doctor`, `next`, `tasks`, `bootstrap`,
`atm-chart render`, and `atm-chart verify`; all required-success commands
passed, with zero module-resolution failures and `usedWorkspaceLink=false`.

## Decision

The fixed TASK-PRF-0062 size and entry thresholds are met while retaining the
complete chart lifecycle. This is candidate-only evidence: it does not prove
that the public registry has been republished. Publish remains a separate
authorized release gate.

