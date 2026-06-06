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
 */
export declare const commonJsonOption: {
    flag: string;
    summary: string;
};
export declare const commonPrettyOption: {
    flag: string;
    summary: string;
};
export declare const commonHelpOption: {
    flag: string;
    alias: string;
    summary: string;
};
export declare const commonCwdOption: {
    flag: string;
    value: string;
    summary: string;
};
