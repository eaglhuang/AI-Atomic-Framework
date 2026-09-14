# ATM command convergence baseline

This report records the first measured change for TASK-PRF-0096. It is a
product-facing report, not a new governance state.

## Baseline

Before the change, the guide prescribed two repository-introspection steps for
an unfamiliar goal: `orient`, followed by `start`. The goal guide also emitted
`orient` as a prerequisite for the legacy-atomization route, while `start`
already called `probeProject` internally. That duplicated the same repository
probe and added one operator command to the normal path.

The public surface remains 21 commands. `orient` remains available as an
explicit diagnostic for users who want its report; this change only removes the
mandatory duplicate step from the recommended workflow.

## Candidate and evidence

The candidate guide now recommends one `start` call for the guidance-first
path, and emits no prerequisite command for the legacy route. `start` continues
to perform the orientation needed to build its route decision. This is a
one-command reduction (2 to 1, 50%) for the measured guidance-first path and
removes one repeated probe from the legacy goal path.

The following assertions are the acceptance boundary:

- `tests/cli/npm-clean-install.test.ts` checks that the recommendation and
  prerequisite projection stay converged.
- `node --strip-types tests/cli/npm-clean-install.test.ts` checks the complete
  npm skeleton contract and the convergence assertions.
- `npm run typecheck` checks the TypeScript source.

## Deletion decision

No safe public command implementation was deleted in this increment. `orient`
is still a useful explicit diagnostic, and `start` has distinct goal/session
semantics. The removed behavior is the duplicate prerequisite recommendation,
not a hidden API removal. Therefore the card's requirement to delete a full
duplicate implementation is **not met by this increment** and must not be
claimed as bundle or product completion. A later candidate must provide
call-site evidence before retiring an implementation.

## Multi-agent preservation

This reduction does not serialize agents or weaken conflict detection. It
shortens only a redundant read/probe in the recommended path; independent
agents may still run concurrently, while shared writes retain existing
attribution and conflict checks.

If the convergence assertions fail, or if a future deletion breaks an alias or
workflow, stop and revert only the owned change.
