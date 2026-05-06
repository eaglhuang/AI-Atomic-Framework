# Contributing

Thanks for contributing to AI-Atomic-Framework. The project values small, reviewable changes that preserve a clean boundary between core contracts, default governance plugins, and host adapters.

## Working Principles

- Keep core contracts neutral and portable.
- Prefer deterministic validation before semantic or model-assisted review.
- Preserve evidence for changes that affect behavior, package boundaries, or governance rules.
- Treat the Default Governance Bundle as a replaceable reference profile, not as core itself.
- Keep examples and templates adopter-neutral unless they live in a clearly named downstream adapter package.

## Contribution Flow

1. Open or select a focused work item.
2. Identify the intended scope before editing.
3. Change the smallest set of files that satisfies the work item.
4. Run the repository validation commands.
5. Include validation output or a concise evidence summary in the pull request.
6. Call out any boundary, migration, or compatibility risk.

## Validation

Run the standard checks before opening a pull request:

```bash
npm test
npm run typecheck
npm run lint
```

Until the package skeleton is expanded, these scripts validate the product charter, documentation boundaries, and repository seed metadata.

## Boundary Rules

The upstream repository must remain host-neutral. Do not make core contracts, protected documentation, examples, templates, or prompt assets depend on a downstream project, product codebase, private task format, engine, local script, or repository path.

If a feature needs host-specific behavior, put the behavior behind an adapter or plugin boundary and document the contract that core consumes.

Before editing protected-surface docs, examples, or templates, review [docs/governance/DOCS_NEUTRALITY_AUDIT.md](docs/governance/DOCS_NEUTRALITY_AUDIT.md).

## Documentation Changes

Documentation should explain decisions in terms of ATM concepts:

- atomic work item;
- scope lock;
- artifact;
- evidence;
- context summary;
- rule guard;
- adapter report;
- plugin capability.

Avoid examples that imply one host project or one AI model is required.

## Pull Request Checklist

- The change has a focused scope.
- Core, plugin, adapter, and Agent Operating Layer boundaries remain clear.
- The Default Governance Bundle is not introduced as a core hard dependency.
- Required validation commands pass, or the failure is explained with a follow-up work item.
- New protected-surface documentation remains adopter-neutral.