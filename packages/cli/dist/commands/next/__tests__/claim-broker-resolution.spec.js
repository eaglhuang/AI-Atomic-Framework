/**
 * ATM-BUG-2026-07-13-160 — claim admission must consume matching
 * atm.brokerConflictResolution.v1 artifacts like the governed commit lane.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBrokerConflictResolutionArtifact, evaluateBrokerConflictResolutionAuthority } from '../../../../../core/dist/team-runtime/permission-broker.js';
import { runTeamBrokerConflictResolve } from '../../team/legacy/broker-observability.js';
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
    const effectiveCandidateTaskId = input.candidateTaskId ?? candidateTaskId;
    const effectiveConflictingTaskId = input.conflictingTaskId ?? conflictingTaskId;
    const overlappingAtomIds = input.overlappingAtomIds ?? ['atm.next-command-atomic-map'];
    const ownerComparison = compareClaimLifecycleOwners({
        current: { actorId: 'codex-current', laneSessionId: input.currentLaneSessionId ?? null },
        conflicting: { actorId: 'codex-conflict', laneSessionId: input.conflictingLaneSessionId ?? null }
    });
    const { shouldBlockPerCid, cidVerdict } = deriveCidVerdict({
        claimIntent: 'write',
        activeWriteConflict: ownerComparison.sameOwner ? false : true,
        confirmedBrokerConflict: false,
        insufficientMutationIntent: true,
        overlappingAtomIdCount: overlappingAtomIds.length
    });
    const effectiveShouldBlockPerCid = resolveEffectiveShouldBlockPerCid({
        shouldBlockPerCid,
        conflictingTaskId: effectiveConflictingTaskId,
        resolutionAuthorizedForeignTaskIds: input.resolutionAuthorizedForeignTaskIds
    });
    const brokerVerdict = deriveBrokerVerdict({
        queuedPrivateWork: false,
        shouldBlockPerCid: effectiveShouldBlockPerCid
    });
    return evaluateClaimAdmission({
        brokerVerdict,
        cidVerdict,
        candidateTaskId: effectiveCandidateTaskId,
        conflictingTaskId: effectiveConflictingTaskId,
        overlappingAtomIds,
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
    // --- ATM-GOV-0255 regression: ATM-GOV-0239 vs ATM-GOV-0249, sharedPaths=[],
    // logical overlap atom-core-registry. First claim must freeze; the official
    // `team broker resolve` command must emit an artifact whose authority
    // envelope admits the retry for exactly this pair/resource, and only that
    // pair/resource. ---
    const primaryTaskId = 'ATM-GOV-0239';
    const conflictTaskId = 'ATM-GOV-0249';
    const foreignTaskId = 'ATM-GOV-9999';
    const overlapAtomId = 'atom-core-registry';
    const govRepo = createRepo();
    try {
        const noArtifactAuthorized = collectResolutionAuthorizedForeignTaskIds(govRepo, primaryTaskId);
        assert.equal(noArtifactAuthorized.size, 0, 'sharedPaths=[] atom overlap must freeze with no resolution artifact');
        const firstClaimFrozen = evaluateCidFreezeAdmission({
            cwd: govRepo,
            resolutionAuthorizedForeignTaskIds: noArtifactAuthorized,
            candidateTaskId: primaryTaskId,
            conflictingTaskId: conflictTaskId,
            overlappingAtomIds: [overlapAtomId]
        });
        assert.equal(firstClaimFrozen.admitted, false, 'first claim over sharedPaths=[] atom overlap must freeze');
        assert.equal(firstClaimFrozen.blockCode, 'ATM_NEXT_CLAIM_BLOCKED');
        const resolveResult = await runTeamBrokerConflictResolve([
            '--task', primaryTaskId,
            '--conflict', conflictTaskId,
            '--path', overlapAtomId,
            '--resource-kind', 'atom',
            '--decision-reason', 'broker-conflict-blocked until the release order grants the next task.',
            '--created-at', '2026-07-22T00:00:00.000Z',
            '--cwd', govRepo,
            '--json'
        ], govRepo);
        assert.equal(resolveResult.ok, true);
        const emittedArtifact = resolveResult.evidence?.artifact;
        assert.equal(emittedArtifact?.schemaId, 'atm.brokerConflictResolution.v1');
        assert.equal(emittedArtifact?.brokerTicket?.schemaId, 'atm.brokerTicket.v1');
        assert.equal(emittedArtifact?.authorizationResourceKind, 'atom');
        assert.deepEqual(emittedArtifact?.conflictFiles, [overlapAtomId]);
        assert.equal(evaluateBrokerConflictResolutionAuthority(emittedArtifact, primaryTaskId).authorized, true);
        const authorizedAfterResolve = collectResolutionAuthorizedForeignTaskIds(govRepo, primaryTaskId);
        assert.ok(authorizedAfterResolve.has(conflictTaskId), 'retry must be admitted for the authorized pair');
        assert.ok(!authorizedAfterResolve.has(foreignTaskId), 'retry must not be admitted for an unrelated task id');
        const retryAdmitted = evaluateCidFreezeAdmission({
            cwd: govRepo,
            resolutionAuthorizedForeignTaskIds: authorizedAfterResolve,
            currentLaneSessionId: 'lane-gov-0255-primary',
            conflictingLaneSessionId: 'lane-gov-0255-conflict',
            candidateTaskId: primaryTaskId,
            conflictingTaskId: conflictTaskId,
            overlappingAtomIds: [overlapAtomId]
        });
        assert.equal(retryAdmitted.admitted, true, 'retry must be admitted only after the official resolve artifact exists');
    }
    finally {
        rmSync(govRepo, { recursive: true, force: true });
    }
    // --- fail closed: legacy artifact with no brokerTicket (pre-ATM-GOV-0255
    // shape) must be rejected with an explicit reason, not a silent pass. ---
    {
        const legacyArtifact = createBrokerConflictResolutionArtifact({
            primaryTaskId,
            conflictingTaskIds: [conflictTaskId],
            sharedPaths: [],
            conflictFiles: [overlapAtomId],
            authorizationResourceKind: 'atom',
            decisionReason: 'legacy shape without a canonical broker ticket.'
        });
        delete legacyArtifact.brokerTicket;
        const legacyCheck = evaluateBrokerConflictResolutionAuthority(legacyArtifact, primaryTaskId);
        assert.equal(legacyCheck.authorized, false);
        assert.equal(legacyCheck.reason, 'missing-broker-ticket');
    }
    // --- fail closed: tampered/stale authority digest must be rejected. ---
    {
        const staleArtifact = createBrokerConflictResolutionArtifact({
            primaryTaskId,
            conflictingTaskIds: [conflictTaskId],
            sharedPaths: [],
            conflictFiles: [overlapAtomId],
            authorizationResourceKind: 'atom',
            decisionReason: 'stale authority digest must fail closed.'
        });
        staleArtifact.authorityDigest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
        const staleCheck = evaluateBrokerConflictResolutionAuthority(staleArtifact, primaryTaskId);
        assert.equal(staleCheck.authorized, false);
        assert.equal(staleCheck.reason, 'authority-digest-mismatch');
    }
    // --- fail closed: over-broad / resource-mismatched conflictFiles (claims a
    // resource key the ticket grant does not cover) must be rejected. ---
    {
        const mismatchedArtifact = createBrokerConflictResolutionArtifact({
            primaryTaskId,
            conflictingTaskIds: [conflictTaskId],
            sharedPaths: [],
            conflictFiles: [overlapAtomId],
            authorizationResourceKind: 'atom',
            decisionReason: 'over-broad resource key must fail closed.'
        });
        mismatchedArtifact.conflictFiles = [overlapAtomId, 'atom-unrelated-surface'];
        const mismatchedCheck = evaluateBrokerConflictResolutionAuthority(mismatchedArtifact, primaryTaskId);
        assert.equal(mismatchedCheck.authorized, false);
        assert.equal(mismatchedCheck.reason, 'resource-key-mismatch');
    }
    console.log('[claim-broker-resolution.spec] ok');
}
finally {
    rmSync(repo, { recursive: true, force: true });
}
