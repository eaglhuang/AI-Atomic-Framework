<!-- doc_id: doc_team_tmpl_spec_compliance_proof -->
# Spec Compliance Proof Template

Use this template when you want to show that an implementation follows a spec in a way that is easy to review, rerun, and audit later.

## Summary

- Task ID: `<task-id>`
- Proof type: `spec-compliance-proof`
- Spec / source of truth: `<spec document or task card>`
- Implementation area: `<feature / module / command>`
- Status: `<draft | verified | blocked>`
- Owner: `<agent id or name>`
- Timestamp: `<RFC3339 timestamp>`

## What We Are Proving

- Claim: `<one short sentence describing the spec compliance claim>`
- Why this matters: `<short explanation>`

## Spec Traceability

| Spec clause / requirement | Implementation artifact | Evidence artifact | Validation command |
| --- | --- | --- | --- |
| `<clause>` | `<file or module>` | `<evidence file>` | `<command>` |
| `<clause>` | `<file or module>` | `<evidence file>` | `<command>` |
| `<clause>` | `<file or module>` | `<evidence file>` | `<command>` |

## Evidence Checklist

- Spec is explicit enough to test
- Implementation points to the right files or modules
- Positive cases were run and passed
- Negative cases were run and failed as expected
- Edge cases were covered
- Evidence files were written and can be replayed later

## Tests Run

| # | Command | Result | What it proves |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | `<exit code / pass-fail>` | `<type safety / interface consistency>` |
| 2 | `<command>` | `<exit code / pass-fail>` | `<spec rule or behavior>` |
| 3 | `<command>` | `<exit code / pass-fail>` | `<edge case or regression gate>` |

## Positive Cases

- `<case name>`: `<expected behavior>`
- `<case name>`: `<expected behavior>`

## Negative Cases

- `<case name>`: `<what must be rejected or blocked>`
- `<case name>`: `<what must be rejected or blocked>`

## Boundary / Risk Notes

- `<boundary condition>`
- `<known limitation>`
- `<risk that still needs follow-up>`

## Conclusion

- Verdict: `<meets spec | partially meets spec | does not meet spec>`
- Reason: `<one or two sentences>`
- Follow-up if any: `<next action or none>`

## Reusable Phrasing

- "The implementation matches the spec clause-by-clause."
- "The evidence shows the happy path and the failure path."
- "This is a compliance proof, not a proof of absolute logical correctness."
- "The tests demonstrate that the behavior is reproducible and reviewable."
