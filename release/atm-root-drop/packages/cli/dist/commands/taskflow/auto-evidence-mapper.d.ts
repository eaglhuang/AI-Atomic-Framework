/**
 * TASK-RFT-0011 — taskflow.autoEvidence.commandMapper atom.
 *
 * Policy Object: given a task-declared validator command and the current
 * repository package.json, decide what command taskflow's auto-evidence
 * executor should actually run.
 *
 * Symptom this atom fixes (from TASK-RFT-0010 close path):
 *   A task card declares `node --strip-types scripts/validate-foo.ts` as its
 *   validator. `evidence.ts::resolveValidatorExpectedCommand` canonicalizes
 *   that to gate `validate:foo` and always rewrites it to `npm run validate:foo`
 *   — regardless of whether such an npm script exists — which then fails with
 *   `ATM_EVIDENCE_VALIDATION_PASS_FAILED_COMMAND`.
 *
 * Policy:
 *   1. If the declared command matches `node --strip-types scripts/<name>.ts [args]`
 *      AND `packageJson.scripts[<name>]` exists AND that npm script maps to the
 *      SAME `node --strip-types scripts/<name>.ts [args]` invocation (with the
 *      identical arg tail), we return the `npm run <name>` form — the two forms
 *      are equivalent and the npm form is what the ecosystem expects.
 *   2. Otherwise we return the declared command verbatim; if the declared
 *      command is malformed, callers still see the original string.
 *
 * The mapper is intentionally pure — it takes only the two inputs and does not
 * touch the filesystem. `taskflow.ts` wires it to the current package.json
 * before calling `executeAutoEvidencePlan`.
 */
export interface PackageJsonLike {
    readonly scripts?: Record<string, string>;
}
export interface AutoEvidenceCommandMapping {
    /** The command that auto-evidence should actually spawn. */
    readonly command: string;
    /**
     * How the mapping decision was reached. Callers may surface this in
     * diagnostics; it is not part of any wire schema.
     */
    readonly source: 'declared-verbatim' | 'declared-verbatim-no-matching-npm-script' | 'declared-verbatim-npm-script-mismatch' | 'npm-script-equivalent' | 'declared-verbatim-unrecognized-shape';
    /** The npm script name we matched, if any. */
    readonly matchedScriptName: string | null;
}
/**
 * Decide the command to run for an auto-evidence step.
 */
export declare function mapAutoEvidenceCommand(declaredCommand: string, packageJson: PackageJsonLike | null | undefined): AutoEvidenceCommandMapping;
