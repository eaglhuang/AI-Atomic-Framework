/**
 * ATM-BUG-2026-07-13-160 — claim admission must consume matching
 * atm.brokerConflictResolution.v1 artifacts like the governed commit lane.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBrokerConflictResolutionArtifact } from '../../../../../core/dist/team-runtime/permission-broker.js';
import { collectResolutionAuthorizedForeignTaskIds, readResolutionAuthorizedForeignTaskIds } from '../../broker-conflict-resolution.js';
import { compareClaimLifecycleOwners, deriveBrokerVerdict, deriveCidVerdict, evaluateClaimAdmission, resolveEffectiveShouldBlockPerCid } from '../claim-admission.js';
const candidateTaskId = 'TASK-AAO-FABLE-004';
const conflictingTaskId = 'TASK-AAO-FABLE-005';
const wrongConflictTaskId = 'TASK-AAO-FABLE-009';
function createRepo() {
    return mkdtempSync(path.join(os.tmpdir(), 'claim-broker-resolution-'));
}
function writeResolutionArtifact(cwd, artifact, fileName) {
    const relativePath = path.join('.atm', 'runtime', 'broker-conflict-resolutions', fileName ?? `${artifact.resolutionId}.json`).replace(/\\/g, '/');
    mkdirSync(path.dirname(path.join(cwd, relativePath)), { recursive: true });
    writeFileSync(path.join(cwd, relativePath), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    return relativePath;
}
function evaluateCidFreezeAdmission(input) {
    const ownerComparison = compareClaimLifecycleOwners({
        current: { actorId: 'codex-current', laneSessionId: input.currentLaneSessionId ?? null },
        conflicting: { actorId: 'codex-conflict', laneSessionId: input.conflictingLaneSessionId ?? null }
    });
    const { shouldBlockPerCid, cidVerdict } = deriveCidVerdict({
        claimIntent: 'write',
        activeWriteConflict: ownerComparison.sameOwner ? false : true,
        confirmedBrokerConflict: false,
        insufficientMutationIntent: true,
        overlappingAtomIdCount: 1
    });
    const effectiveShouldBlockPerCid = resolveEffectiveShouldBlockPerCid({
        shouldBlockPerCid,
        conflictingTaskId,
        resolutionAuthorizedForeignTaskIds: input.resolutionAuthorizedForeignTaskIds
    });
    const brokerVerdict = deriveBrokerVerdict({
        queuedPrivateWork: false,
        shouldBlockPerCid: effectiveShouldBlockPerCid
    });
    return evaluateClaimAdmission({
        brokerVerdict,
        cidVerdict,
        candidateTaskId,
        conflictingTaskId,
        overlappingAtomIds: ['atm.next-command-atomic-map'],
        ownerComparison
    });
}
const repo = createRepo();
try {
    // --- no artifact → freeze ---
    const noArtifactAuthorized = collectResolutionAuthorizedForeignTaskIds(repo, candidateTaskId);
    assert.equal(noArtifactAuthorized.size, 0);
    const frozen = evaluateCidFreezeAdmission({
        cwd: repo,
        resolutionAuthorizedForeignTaskIds: noArtifactAuthorized
    });
    assert.equal(frozen.admitted, false);
    assert.equal(frozen.blockCode, 'ATM_NEXT_CLAIM_BLOCKED');
    assert.match(frozen.blockReason ?? '', /freeze/i);
    // --- matching BCR → admit ---
    const matchingRepo = createRepo();
    try {
        const matchingArtifact = createBrokerConflictResolutionArtifact({
            primaryTaskId: candidateTaskId,
            conflictingTaskIds: [conflictingTaskId],
            sharedPaths: ['packages/cli/src/commands/next.ts'],
            decisionReason: 'broker-conflict-blocked until the release order grants the next task.'
        });
        const matchingPath = writeResolutionArtifact(matchingRepo, matchingArtifact);
        const matchingAuthorized = collectResolutionAuthorizedForeignTaskIds(matchingRepo, candidateTaskId);
        assert.ok(matchingAuthorized.has(conflictingTaskId.toUpperCase()));
        assert.deepEqual([...readResolutionAuthorizedForeignTaskIds(matchingRepo, matchingPath, candidateTaskId)], [conflictingTaskId.toUpperCase()]);
        const admitted = evaluateCidFreezeAdmission({
            cwd: matchingRepo,
            resolutionAuthorizedForeignTaskIds: matchingAuthorized,
            currentLaneSessionId: 'lane-a',
            conflictingLaneSessionId: 'lane-b'
        });
        assert.equal(admitted.admitted, true);
        assert.equal(admitted.blockCode, null);
        assert.equal(admitted.ownerComparison?.mode, 'lane-id');
    }
    finally {
        rmSync(matchingRepo, { recursive: true, force: true });
    }
    const sameLaneAdmitted = evaluateCidFreezeAdmission({
        cwd: repo,
        resolutionAuthorizedForeignTaskIds: new Set(),
        currentLaneSessionId: 'lane-shared',
        conflictingLaneSessionId: 'lane-shared'
    });
    assert.equal(sameLaneAdmitted.admitted, true, 'same lane should not freeze as an active foreign owner');
    assert.equal(sameLaneAdmitted.ownerComparison?.mode, 'lane-id');
    // --- wrong-pair artifact → still freeze ---
    const wrongPairRepo = createRepo();
    try {
        const wrongPairArtifact = createBrokerConflictResolutionArtifact({
            primaryTaskId: candidateTaskId,
            conflictingTaskIds: [wrongConflictTaskId],
            sharedPaths: ['packages/cli/src/commands/next.ts'],
            decisionReason: 'broker-conflict-blocked for an unrelated pair.'
        });
        writeResolutionArtifact(wrongPairRepo, wrongPairArtifact);
        const wrongPairAuthorized = collectResolutionAuthorizedForeignTaskIds(wrongPairRepo, candidateTaskId);
        assert.ok(!wrongPairAuthorized.has(conflictingTaskId.toUpperCase()));
        const stillFrozen = evaluateCidFreezeAdmission({
            cwd: wrongPairRepo,
            resolutionAuthorizedForeignTaskIds: wrongPairAuthorized
        });
        assert.equal(stillFrozen.admitted, false);
        assert.equal(stillFrozen.blockCode, 'ATM_NEXT_CLAIM_BLOCKED');
    }
    finally {
        rmSync(wrongPairRepo, { recursive: true, force: true });
    }
    console.log('[claim-broker-resolution.spec] ok');
}
finally {
    rmSync(repo, { recursive: true, force: true });
}
