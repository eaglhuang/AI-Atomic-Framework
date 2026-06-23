# CLI Result Contract v1

This document defines the bridge-facing ATM CLI result contract for tool-first
consumers. It builds on the public error-policy contract in
[docs/cli-error-policy.md](../cli-error-policy.md) and adds the projection
fields that skills and future tool bridges should consume directly.

Schema:

- `schemas/governance/cli-result.schema.json`

## Goal

Every ATM CLI command should produce one stable machine-readable envelope that:

- works for normal CLI automation;
- works for skill-first entrypoints;
- keeps governance semantics in `evidence` and `messages`, not in transport;
- exposes common follow-up fields without requiring text scraping.

## Top-level shape

The result contract always includes:

- `ok`
- `command`
- `mode`
- `cwd`
- `messages`
- `evidence`
- `severity`
- `exitCode`
- `blocking`
- `diagnostics`

The bridge projection may also expose:

- `nextAction`
- `userNotice`
- `runnerMode`
- `allowedCommands`
- `blockedCommands`
- `skillGrowth`

## Projection semantics

### `nextAction`

Use for deterministic next-step routing. This remains the main governance
handoff object for `next`, blocked routes, and playbook-driven follow-up.

### `userNotice`

Use when the CLI wants the human-facing caller to surface a short notice before
 continuing.

### `runnerMode`

Use when the caller must understand frozen vs source-first execution or a build
sync requirement.

### `allowedCommands` / `blockedCommands`

Use these to avoid guessing from prose. They are transport-facing summaries and
do not replace the richer governance payload inside `evidence.nextAction`.

### `skillGrowth`

Use this optional object for shared learning-loop and reusable exception hints.
This field exists so tool-capable skills can receive durable guidance such as:

- reusable wall-hit categories;
- safer route hints;
- tooling-mismatch diagnostics;
- learning-loop promotion metadata.

`skillGrowth` is intentionally optional and schema-light in v1. The bridge owns
the envelope; individual skills should not invent separate top-level wrappers.

## Boundary

- Transport and shape validation belong to the bridge/result contract.
- Governance meaning still belongs to ATM commands, `messages`, and `evidence`.
- This contract does not require a remote broker or editor plugin.
