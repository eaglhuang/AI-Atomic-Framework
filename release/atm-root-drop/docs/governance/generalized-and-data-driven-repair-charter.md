# Generalized and Data-Driven Repair Charter

This document explains `INV-ATM-009`, the AtomicCharter invariant that requires
ATM code logic, bug fixes, and governance rule changes to prefer generalized,
evidence-bounded repair over hard-coded special cases.

## Principle

When ATM changes behavior, the first design question is: what general rule
explains the observed failure class?

A fix should address the class of failures that the evidence supports, not only
the single example that happened to fail first. If the safe general rule is not
yet known, the implementation may use a bounded exception, but the commit must
record why the general rule is deferred and how the exception can be removed.

## Data-shaped behavior

If the behavior is driven by thresholds, mappings, allowlists, routing choices,
telemetry classes, prompts, message text, fixtures, or domain content, the first
design option must separate data from control flow.

Prefer:

- schemas or registries for structured policy;
- configuration for environment-specific choices;
- observed counters or telemetry for measured decisions;
- compact digests for persisted evidence; and
- fixtures for reproducible examples.

Avoid embedding changeable numbers or strings directly in code branches unless
there is a recorded reason that the value is truly invariant.

## Bounded exceptions

Hard-coded special cases are allowed only when all of the following are true:

1. The exception is safer than the available general rule.
2. The affected scope is named and intentionally narrow.
3. The evidence explains why the general rule is deferred.
4. A validator or follow-up item makes the exception removable.

## Non-goals

This invariant does not require speculative abstraction. A generalized repair
must still be observable, testable, and no broader than the current evidence
supports.
