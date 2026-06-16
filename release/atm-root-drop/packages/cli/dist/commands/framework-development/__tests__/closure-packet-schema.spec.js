import assert from 'node:assert/strict';
import { validateClosurePacket } from '../closure-packet-schema.js';
const digest = `sha256:${'a'.repeat(64)}`;
function validPacket(overrides = {}) {
    return {
        schemaId: 'atm.closurePacket.v1',
        specVersion: '0.1.0',
        taskId: 'TASK-RFT-0003',
        targetRepoIdentity: {
            isFrameworkRepo: true,
            score: 5,
            root: '/repo',
            name: 'ai-atomic-framework',
            signals: ['package-name:ai-atomic-framework']
        },
        targetCommit: 'abc123',
        governedTreeSha: 'tree123',
        targetCommitDelta: {
            currentCommitSha: 'abc123',
            parentCommitShas: ['parent123'],
            governedTreeSha: 'tree123',
            changedFiles: ['packages/cli/src/commands/framework-development.ts']
        },
        closedByCommand: 'atm tasks close',
        commandRuns: [{
                command: 'npm run typecheck',
                cwd: '.',
                exitCode: 0,
                stdoutSha256: digest,
                stderrSha256: digest,
                runnerVersion: 'test'
            }],
        validationPasses: ['typecheck', 'validate:cli'],
        evidenceFreshness: 'fresh',
        requiredGates: ['typecheck', 'validate:cli'],
        requiredGatesSnapshot: {
            schemaId: 'atm.requiredGatesSnapshot.v1',
            generatedAt: '2026-06-14T00:00:00.000Z',
            source: 'frameworkStatus.requiredGates',
            ruleVersion: '0.1.0',
            frameworkMode: 'required',
            repoRole: 'framework',
            changedFiles: ['packages/cli/src/commands/framework-development.ts'],
            criticalChangedFiles: ['packages/cli/src/commands/framework-development.ts'],
            requiredGates: ['typecheck', 'validate:cli']
        },
        evidencePath: '.atm/history/evidence/TASK-RFT-0003.json',
        closedAt: '2026-06-14T00:00:00.000Z',
        closedByActor: 'captain-teamagents',
        sessionId: null,
        attestation: null,
        repair: null,
        historicalDeliveryProvenance: null,
        ...overrides
    };
}
assert.equal(validateClosurePacket(validPacket()).ok, true);
const missingTargetCommitDelta = validateClosurePacket({
    ...validPacket(),
    targetCommitDelta: undefined
});
assert.equal(missingTargetCommitDelta.ok, false);
assert.ok(missingTargetCommitDelta.missing.includes('targetCommitDelta'));
const shaMismatch = validateClosurePacket({
    ...validPacket(),
    commandRuns: [{
            ...validPacket().commandRuns[0],
            stdoutSha256: 'sha256:not-valid'
        }]
});
assert.equal(shaMismatch.ok, false);
assert.equal(shaMismatch.invalidFormat[0]?.path, 'commandRuns/0/stdoutSha256');
const repairRoundTrip = validateClosurePacket(validPacket({
    repair: {
        schemaId: 'atm.closurePacketRepair.v1',
        repairedAt: '2026-06-14T00:00:00.000Z',
        repairedByCommand: 'atm tasks repair-closure',
        originalPacketCommitSha: 'old',
        repairedTargetCommitSha: 'new',
        evidencePath: '.atm/history/evidence/git-head.jsonl'
    }
}));
assert.equal(repairRoundTrip.ok, true);
console.log('[framework-development-closure-packet-schema:test] ok');
