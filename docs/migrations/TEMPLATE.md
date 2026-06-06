# Migration Guide Template

<!-- Use this template for every migration guide in docs/migrations/. -->
<!-- File naming: <from-version>-to-<to-version>.md -->

## Migration: `<FROM_VERSION>` → `<TO_VERSION>`

| Property | Value |
|---|---|
| Breaking | Yes / No |
| ATM Chart Version | `<FROM_VERSION>` → `<TO_VERSION>` |
| Automated Codemod | Yes / No |
| Fixture | `fixtures/migrations/<fixture-dir>` |

---

### What Changed

<!-- Describe the breaking change in plain language. -->

### Why It Changed

<!-- Explain the architectural reason or policy change that required this break. -->

### Affected Files

<!-- List the files or patterns that will be transformed by the codemod. -->

- `.atm/memory/atm-chart.md`

### Manual Steps

<!-- If the codemod does NOT handle everything automatically, list any steps the user must perform manually. -->

1. (None — the automated codemod handles all required changes.)

### Automated Codemod

Run the following command to apply the migration automatically:

```bash
node atm.mjs migrate plan --from <FROM_VERSION> --to <TO_VERSION> --json
node atm.mjs migrate apply --from <FROM_VERSION> --to <TO_VERSION> --json
```

Verify the result against the bundled fixture:

```bash
node atm.mjs migrate verify --fixture fixtures/migrations/<fixture-dir> --json
```

### Rollback

The `apply` action backs up all modified files under `.atm/backups/migrate-<id>/`. To restore:

```bash
# Copy the backed-up files back manually from .atm/backups/migrate-<id>/
```

### Fixture Reference

See `fixtures/migrations/<fixture-dir>/` for a minimal before/after example:

- `before/` — sample files before the migration
- `after/` — expected files after the migration is applied
