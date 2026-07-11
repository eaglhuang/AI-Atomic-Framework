/**
 * TASK-RFT-0011 spec — taskflow.autoEvidence.commandMapper.
 *
 * Covers the three branches of `mapAutoEvidenceCommand`:
 *   1. Declared `node --strip-types scripts/<name>.ts` + matching npm script → `npm run <name>`
 *   2. Declared node script BUT no matching npm script → declared verbatim
 *   3. Malformed declared → verbatim (documented, original error surfaces
 *      downstream)
 */
import assert from 'node:assert/strict';
import { mapAutoEvidenceCommand } from '../auto-evidence-mapper.js';
// --- 1. known npm script → npm form ---
const knownPkg = {
    scripts: {
        'validate:governance-fix-wave': 'node --strip-types scripts/validate-governance-fix-wave.ts'
    }
};
const knownMapping = mapAutoEvidenceCommand('node --strip-types scripts/validate-governance-fix-wave.ts', knownPkg);
assert.equal(knownMapping.command, 'npm run validate:governance-fix-wave', 'known npm script must map to npm run form');
assert.equal(knownMapping.source, 'npm-script-equivalent');
assert.equal(knownMapping.matchedScriptName, 'validate:governance-fix-wave');
// --- 1b. equivalence must also match on trailing args ---
const knownWithArgsPkg = {
    scripts: {
        'validate:cli': 'node --strip-types scripts/validate-cli.ts --mode validate'
    }
};
const knownWithArgsMapping = mapAutoEvidenceCommand('node --strip-types scripts/validate-cli.ts --mode validate', knownWithArgsPkg);
assert.equal(knownWithArgsMapping.command, 'npm run validate:cli');
assert.equal(knownWithArgsMapping.source, 'npm-script-equivalent');
// --- 1c. mismatched tail must NOT swap to npm form ---
const mismatchedTail = mapAutoEvidenceCommand('node --strip-types scripts/validate-cli.ts --mode surface', knownWithArgsPkg);
assert.equal(mismatchedTail.command, 'node --strip-types scripts/validate-cli.ts --mode surface');
assert.equal(mismatchedTail.source, 'declared-verbatim-npm-script-mismatch');
assert.equal(mismatchedTail.matchedScriptName, 'validate:cli');
// --- 2. unknown npm script + valid declared → declared verbatim ---
const unknownMapping = mapAutoEvidenceCommand('node --strip-types scripts/validate-newthing.ts', { scripts: {} });
assert.equal(unknownMapping.command, 'node --strip-types scripts/validate-newthing.ts');
assert.equal(unknownMapping.source, 'declared-verbatim-no-matching-npm-script');
assert.equal(unknownMapping.matchedScriptName, null);
// --- 2b. null package json → declared verbatim ---
const nullPkgMapping = mapAutoEvidenceCommand('node --strip-types scripts/validate-anything.ts', null);
assert.equal(nullPkgMapping.command, 'node --strip-types scripts/validate-anything.ts');
assert.equal(nullPkgMapping.source, 'declared-verbatim-no-matching-npm-script');
// --- 3. malformed declared → verbatim (unrecognized shape) ---
const malformedMapping = mapAutoEvidenceCommand('this-is-not-a-node-invocation', knownPkg);
assert.equal(malformedMapping.command, 'this-is-not-a-node-invocation');
assert.equal(malformedMapping.source, 'declared-verbatim-unrecognized-shape');
// --- 3b. non-node command → verbatim ---
const gitMapping = mapAutoEvidenceCommand('git diff --check', knownPkg);
assert.equal(gitMapping.command, 'git diff --check');
assert.equal(gitMapping.source, 'declared-verbatim-unrecognized-shape');
// --- 3c. plain `npm run <x>` declared → verbatim (already in npm form) ---
const alreadyNpmMapping = mapAutoEvidenceCommand('npm run typecheck', knownPkg);
assert.equal(alreadyNpmMapping.command, 'npm run typecheck');
assert.equal(alreadyNpmMapping.source, 'declared-verbatim-unrecognized-shape');
console.log('[auto-evidence-mapper.spec] ok');
