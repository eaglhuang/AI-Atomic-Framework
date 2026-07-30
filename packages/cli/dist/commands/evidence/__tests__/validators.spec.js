import assert from 'node:assert/strict';
import { runEvidenceValidators } from '../verbs/validators.js';
import { assessEvidenceFreshness } from '../missing-report.js';
const listed = runEvidenceValidators(['--list', '--task', 'TASK-RFT-0007', '--json']);
assert.equal(listed.ok, true);
assert.ok(Array.isArray(listed.evidence?.validators) || Array.isArray(listed.evidence?.catalog) || listed.evidence);
const again = runEvidenceValidators(['--list', '--task', 'TASK-RFT-0007', '--json']);
assert.equal(again.ok, true);
const validators = [
    {
        name: 'typecheck',
        tier: 'focused',
        closureRequired: true,
        expectedCommand: 'npm run typecheck',
        evidenceState: 'pass'
    },
    {
        name: 'validate:cli',
        tier: 'focused',
        closureRequired: true,
        expectedCommand: 'npm run validate:cli',
        evidenceState: 'pass'
    },
    {
        name: 'tasks-audit',
        tier: 'batch',
        closureRequired: false,
        expectedCommand: 'node atm.mjs tasks audit --json',
        evidenceState: 'absent'
    }
];
const freshness = assessEvidenceFreshness({
    taskId: 'TASK-FRESHNESS-0001',
    deliveryCommit: 'commit-new',
    touchedFiles: ['dist/ignored-report.json'],
    declaredArtifacts: ['dist/ignored-report.json'],
    actorId: 'validator',
    runnerKind: 'frozen-runner',
    validators,
    validatorReceipts: [
        {
            evidenceFreshness: 'fresh',
            validationPasses: ['typecheck'],
            artifactPaths: ['dist/typecheck.txt'],
            commandRuns: [{
                    command: 'npm run typecheck',
                    exitCode: 0,
                    stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
                    stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
                    sourceCommit: 'commit-new'
                }]
        },
        {
            evidenceFreshness: 'fresh',
            validationPasses: ['validate:cli'],
            artifactPaths: ['dist/ignored-report.json'],
            commandRuns: [{
                    command: 'npm run validate:cli',
                    exitCode: 0,
                    stdoutSha256: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
                    stderrSha256: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
                    sourceCommit: 'commit-old'
                }]
        }
    ]
});
assert.equal(freshness.schemaId, 'atm.evidenceFreshnessVerdict.v1');
assert.equal(freshness.status, 'partially-stale');
assert.deepEqual(freshness.rerunPlan.validators, ['validate:cli']);
assert.deepEqual(freshness.rerunPlan.commands, ['npm run validate:cli']);
assert.deepEqual(freshness.rerunPlan.skippedHeavyweightValidators, ['tasks-audit']);
assert.ok(freshness.rerunPlan.requiredCommands[0]?.includes('--command "npm run validate:cli"'));
assert.ok(freshness.reasons.some((reason) => reason.includes('source commit differs')));
assert.ok(freshness.reasons.some((reason) => reason.includes('artifact touched')));
assert.deepEqual(freshness.artifactChecks.find((entry) => entry.path === 'dist/ignored-report.json'), {
    path: 'dist/ignored-report.json',
    declared: true,
    referencedByEvidence: true,
    touched: true
});
console.log('[validators.spec] ok');
