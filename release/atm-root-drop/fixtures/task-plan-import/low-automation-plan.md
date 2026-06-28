# 3KLife / npc-brain low-manual-automation roadmap

This fixture mirrors the low-manual-automation plan shape used by the
`3klife-npc-brain` host. It deliberately keeps a thin acceptance criteria
list so the import flow proves that minimal plans still produce valid task
files.

## SANGUO-AUTO-0001 Catalog candidate scripts

- status: open
- milestone: M0

### Acceptance Criteria
- [ ] Source inventory report covers `pipelines/**/*.py`.
- [ ] Candidate ranking report exists for the same scope.

### Deliverables
- candidate ranking JSON
- source inventory JSON

## SANGUO-AUTO-0002 Plan dry-run atomize for ranked entrypoint

- status: planned
- milestone: M0

### Dependencies
- SANGUO-AUTO-0001

### Acceptance Criteria
- [ ] Plan markdown explains which entrypoint is being targeted.
- [ ] Plan markdown notes evidence required before apply.
