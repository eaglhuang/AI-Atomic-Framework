---
task_id: TASK-FIXTURE-0001
title: Single-card import fixture
milestone: M1
status: open
blocked_by:
  - TASK-FIXTURE-0000
tags: [fixture, single-card]
---

# TASK-FIXTURE-0001 Single-card import fixture

## Background

Used to verify that the import flow can ingest a task card written as a single
markdown document with YAML front matter.

## Acceptance Criteria

- [ ] Task id, title, milestone, status, and blocked_by parse correctly.
- [ ] Source trace recorded for the single-card heading.
- [ ] Importing twice without changes is idempotent.

## Deliverables

- imported task JSON
- import evidence JSON
