# Migration Guide: `0.0.1` → `0.1.0`

| Property | Value |
|---|---|
| Breaking | Yes |
| ATM Chart Version | `0.0.1` → `0.1.0` |
| Automated Codemod | Yes (`atm-chart-version-bump`) |
| Fixture | `fixtures/migrations/atm-chart-0.0.1-to-0.1.0` |

---

### What Changed

The `atm_chart_version` frontmatter field in `.atm/memory/atm-chart.md` must be updated from `0.0.1` to `0.1.0`.

ATMChart version `0.0.1` is classified as **unsupported** in the compatibility matrix (see `scripts/compatibility-matrix.json`). Any workspace running framework version `0.0.0` or later must use ATMChart `0.1.0`.

### Why It Changed

ATMChart `0.0.1` was a pre-release format that predated the finalised `default-guards` schema (`atm.defaultGuards.v0.1`). Version `0.1.0` aligns the chart version with the stable schema, adds the `source_guards_sha256` integrity field, and introduces the `source_schema_sha256s` map for multi-schema integrity checks.

### Affected Files

- `.atm/memory/atm-chart.md` — the `atm_chart_version:` frontmatter line is updated.

### Manual Steps

1. (None — the automated codemod handles all required changes.)

> **Note:** If your ATMChart file contains significant local customisations, review the diff in `.atm/backups/` after applying.

### Automated Codemod

```bash
node atm.mjs migrate plan --from 0.0.1 --to 0.1.0 --json
node atm.mjs migrate apply --from 0.0.1 --to 0.1.0 --json
```

Verify the result against the bundled fixture:

```bash
node atm.mjs migrate verify --fixture fixtures/migrations/atm-chart-0.0.1-to-0.1.0 --json
```

### Rollback

Backed-up files are written to `.atm/backups/migrate-0_0_1-to-0_1_0-<id>/` during `apply`. To rollback manually, copy the `atm-chart.md` from that backup back to `.atm/memory/atm-chart.md`.

### Fixture Reference

See `fixtures/migrations/atm-chart-0.0.1-to-0.1.0/`:

- `before/atm-chart.md` — ATMChart with `atm_chart_version: 0.0.1`
- `after/atm-chart.md` — expected ATMChart with `atm_chart_version: 0.1.0`
