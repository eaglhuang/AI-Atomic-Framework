# Evidence Ledger boundary baseline

Date: 2026-09-14  
Source: `TASK-PRF-0091-runtime-evidence-history-audit-2026-09-14.json`

This report separates historical Git footprint from future runtime growth. It
does not claim that Git history was shrunk and it does not authorize history
rewriting.

## Historical footprint (retained)

| Measure | Baseline |
| --- | ---: |
| Tracked `.atm/history/evidence` files | 3,398 |
| Tracked `.atm/history/evidence` bytes | 93,473,105 |
| Evidence-touching commits | 3,658 |
| Runner-sync class files | 178 |
| Runner-sync class bytes | 55,492,875 |
| Migration manifest records | 5,752 |
| Legacy paths represented by the manifest | 849 |

These files remain retained legacy inputs. No deletion, redaction, relocation,
or rewrite is part of this boundary change.

## Future growth avoided

New runtime evidence is written below `.atm/runtime/evidence-ledger/` and is
ignored by the repository-owned `.gitignore` rule. The avoided growth is the
future payload that would otherwise have been added to Git; it is not a
reduction of the historical byte baseline above. Runtime records remain
content-addressed and can be exported/restored through the migration manifest
and checkpoint verification.

## Verification and rollback

The boundary validator fails closed when the repository-owned ignore rule is
missing or a runtime-ledger path is tracked. A clean clone test disables global
and local excludes and attributes the ignore decision to `.gitignore`.

Rollback is a single governed revert of the ignore, validator, tests, and
documentation changes. Legacy evidence remains untouched. Any future history
rewrite requires a separate owner-authorized migration card with an export,
restore, checkpoint, and recovery receipt before execution.
