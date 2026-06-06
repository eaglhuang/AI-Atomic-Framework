/**
 * Codemod registry for ATM migration tooling.
 *
 * A codemod is a pure transformation function:
 *   (content: string, relativePath: string) => string | null
 *
 * Return null when the codemod does not apply to this file, or when the file
 * does not need transformation (already up-to-date).  Return the transformed
 * content string when a change should be written.
 */
export type CodemodFn = (content: string, relativePath: string) => string | null;
export interface CodemodEntry {
    id: string;
    description: string;
    /** Glob-like hint — used by the planner to decide which files to scan. */
    targetPattern: string;
    apply: CodemodFn;
}
/** Register a codemod so the migration planner can look it up. */
export declare function registerCodemod(entry: CodemodEntry): void;
/** Look up a registered codemod by id. */
export declare function getCodemod(id: string): CodemodEntry | undefined;
/** List all registered codemod ids. */
export declare function listCodemods(): string[];
/**
 * Build the full set of CodemodEntry objects needed for a specific migration
 * step (fromVersion → toVersion) given the codemod ids declared in the
 * migration index entry.
 */
export declare function resolveCodemodsForMigration(codemodIds: string[], fromVersion: string, toVersion: string): CodemodEntry[];
