/**
 * Shared option constants for command-specs entries.
 *
 * Extracted from `packages/cli/src/commands/command-specs.ts` per the
 * `command-specs.SPLIT_PLAN.md` Layer 2 split. These four options
 * appear on every command spec; centralising them keeps the per-command
 * spec entries focused on their unique surface.
 *
 * Surface contract: the option `flag` / `summary` / `alias` / `value`
 * strings ARE part of the public help output (invariant I1). The
 * help-snapshot fixtures under `tests/cli-fixtures/help-snapshots/`
 * gate accidental drift.
 *
 * Result contract: every `--json` response includes `ok`, `severity`,
 * `exitCode`, `blocking`, and `diagnostics` in addition to `messages`
 * and `evidence`. See `docs/cli-error-policy.md`.
 */
export const commonJsonOption = {
    flag: '--json',
    summary: 'Force machine-readable JSON output with the standard result contract (ok, severity, exitCode, blocking, diagnostics).'
};
export const commonPrettyOption = { flag: '--pretty', summary: 'Force human-readable pretty output.' };
export const commonHelpOption = { flag: '--help', alias: '-h', summary: 'Show command help.' };
export const commonCwdOption = { flag: '--cwd', value: 'path', summary: 'Run the command against a specific repository root.' };
