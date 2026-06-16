# framework-development atomic map

Task: TASK-RFT-0003 framework-development.ts temp-claim lifecycle extraction

## Facade

- `packages/cli/src/commands/framework-development.ts` is now a five-line facade.
- The original public command surface remains reachable through facade re-exports.
- The facade stays below the 900-line task threshold.

## Extracted entrypoints

| Module | Responsibility | Verification |
| --- | --- | --- |
| `closure-packet-schema` | Closure packet contracts, validation, creation, repair, and the shared implementation surface preserved from the previous monolith. | `closure-packet-schema.spec.ts` |
| `critical-path-gate` | Critical close-governance path predicate entrypoint. | `critical-path-gate.spec.ts` |
| `historical-delivery-provenance` | Historical delivery provenance type plus small waiver/file-count helpers. | `historical-delivery-provenance.spec.ts` |
| `sha256-normalization` | SHA-256 digest normalization helpers used by closure packet repair and validation. | `sha256-normalization.spec.ts` |
| `temp-claim` | Framework temporary claim/stale-lock command and classification entrypoint. | `temp-claim.spec.ts` |

## Notes

This pass is a facade-first extraction. It creates stable concern-specific import targets and focused tests without changing CLI behavior or closure packet field names. The remaining internal shared implementation inside `closure-packet-schema.ts` is intentionally left for later RFT slices so this task can reduce the command entrypoint risk before deeper function-level moves.

## Validator

`scripts/validate-framework-development-atomic-map.ts` checks the facade line limit, required module/spec presence, closure packet public surface, and this report.
