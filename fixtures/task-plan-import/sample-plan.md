# Sample Roadmap

This fixture covers a synthetic plan with multiple tasks and explicit dependencies.

## TASK-EXAMPLE-0001 Bootstrap synthetic adopter

- status: open
- milestone: M1

### Dependencies
- none

### Acceptance Criteria
- [ ] Bootstrap pack is generated.
- [ ] Initial governance config is committed.

### Outputs
- .atm/history/evidence/TASK-EXAMPLE-0001.json

### Notes
Used as the entrypoint for synthetic adopter onboarding tests.

## TASK-EXAMPLE-0002 Run candidate ranking on pipelines

- status: planned
- milestone: M1

### Dependencies
- TASK-EXAMPLE-0001

### Acceptance Criteria
- [ ] Candidate ranking report exists.
- [ ] Police family report passes the standard profile.

### Deliverables
- artifacts/ranked-candidates.json
- artifacts/police-family.json

### Notes
Verifies that the imported tasks remain inert until the adopter chooses to act.
