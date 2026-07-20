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
const NODE_STRIP_TYPES_RE = /^node\s+--strip-types\s+scripts\/([A-Za-z0-9_.-]+)\.ts(\s+.*)?$/;
const ATM_PSEUDO_SUBCOMMAND_RE = /^node\s+atm\.mjs\s+([A-Za-z0-9_.:-]+)\s+--json$/;
function normalizeInvocation(raw) {
    return raw.trim().replace(/\s+/g, ' ');
}
/**
 * Parse a `node --strip-types scripts/<name>.ts <tail?>` invocation. Returns
 * null for anything that does not match that shape.
 *
 * `scriptBaseName` is the raw filename stem (e.g. `validate-governance-fix-wave`).
 * `candidateScriptNames` lists the npm-script keys we should try in order —
 * both the raw stem and the `validate-<x>` → `validate:<x>` transform used by
 * evidence.ts's canonicalizer.
 */
function parseNodeStripTypesInvocation(raw) {
    const normalized = normalizeInvocation(raw);
    const match = NODE_STRIP_TYPES_RE.exec(normalized);
    if (!match)
        return null;
    const scriptBaseName = match[1];
    const tail = (match[2] ?? '').trim();
    const candidates = [scriptBaseName];
    const validateMatch = scriptBaseName.match(/^validate-(.+)$/);
    if (validateMatch) {
        candidates.push(`validate:${validateMatch[1]}`);
    }
    return { scriptBaseName, candidateScriptNames: candidates, tail };
}
/**
 * Decide the command to run for an auto-evidence step.
 */
export function mapAutoEvidenceCommand(declaredCommand, packageJson) {
    const declared = normalizeInvocation(declaredCommand);
    const atmPseudoMatch = ATM_PSEUDO_SUBCOMMAND_RE.exec(declared);
    if (atmPseudoMatch) {
        const scriptName = atmPseudoMatch[1];
        const scriptCommand = packageJson?.scripts?.[scriptName];
        if (typeof scriptCommand === 'string' && scriptCommand.trim().length > 0) {
            return {
                command: `npm run ${scriptName}`,
                source: 'npm-script-for-atm-pseudo-command',
                matchedScriptName: scriptName
            };
        }
    }
    const parsed = parseNodeStripTypesInvocation(declared);
    if (!parsed) {
        return {
            command: declared,
            source: 'declared-verbatim-unrecognized-shape',
            matchedScriptName: null
        };
    }
    const scripts = packageJson?.scripts ?? {};
    let matchedName = null;
    let scriptCommand = null;
    for (const candidate of parsed.candidateScriptNames) {
        const value = scripts[candidate];
        if (typeof value === 'string' && value.trim().length > 0) {
            matchedName = candidate;
            scriptCommand = value;
            break;
        }
    }
    if (!matchedName || !scriptCommand) {
        return {
            command: declared,
            source: 'declared-verbatim-no-matching-npm-script',
            matchedScriptName: null
        };
    }
    const scriptParsed = parseNodeStripTypesInvocation(scriptCommand);
    if (!scriptParsed) {
        // The npm script exists but does something else — do not silently swap.
        return {
            command: declared,
            source: 'declared-verbatim-npm-script-mismatch',
            matchedScriptName: matchedName
        };
    }
    if (scriptParsed.scriptBaseName !== parsed.scriptBaseName || scriptParsed.tail !== parsed.tail) {
        return {
            command: declared,
            source: 'declared-verbatim-npm-script-mismatch',
            matchedScriptName: matchedName
        };
    }
    return {
        command: `npm run ${matchedName}`,
        source: 'npm-script-equivalent',
        matchedScriptName: matchedName
    };
}
