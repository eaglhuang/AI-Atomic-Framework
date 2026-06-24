import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateTeamBrokerLane, projectTeamBrokerRearbitrationSnapshot } from '../team-lane.js';
import { registerIntent } from '../registry.js';
function testHotFileRequiresProposalFirstAdmission() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-team-lane-'));
    const registryPath = path.join(tempDir, 'write-broker.registry.json');
    const result = evaluateTeamBrokerLane({
        cwd: tempDir,
        taskId: 'TASK-CID-0116',
        actorId: 'captain',
        task: {
            workItemId: 'TASK-CID-0116',
            title: 'proposal-first hot file lane',
            atomizationImpact: { ownerAtomOrMap: 'atm.proposal-first-team-gate' }
        },
        writePaths: ['packages/cli/src/commands/broker.ts'],
        registryPath
    });
    assert.equal(result.ok, false);
    assert.equal(result.evidence.admission.trigger, 'hot-file');
    assert.equal(result.evidence.admission.state, 'proposal-submitted');
    assert.equal(result.evidence.safeToStart, false);
    rmSync(tempDir, { recursive: true, force: true });
    console.log('ok: hot file requires proposal-first admission before start');
}
function testBoundedRegionProducesStableSyntheticAtomCid() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-team-lane-'));
    const registryPath = path.join(tempDir, 'write-broker.registry.json');
    const result = evaluateTeamBrokerLane({
        cwd: tempDir,
        taskId: 'TASK-PAPER-HOTFILE-POS2-A',
        actorId: 'captain',
        task: {
            workItemId: 'TASK-PAPER-HOTFILE-POS2-A',
            title: 'bounded region lane',
            atomizationImpact: { ownerAtomOrMap: 'atm.broker.classify-explicit-mutation-request' },
            proposalAdmission: {
                trigger: 'same-file-overlap-risk',
                summarySubmitted: true,
                boundedRegions: [{
                        filePath: 'packages/cli/src/commands/broker.ts',
                        lineStart: 841,
                        lineEnd: 878
                    }]
            }
        },
        writePaths: ['packages/cli/src/commands/broker.ts'],
        registryPath
    });
    assert.equal(result.evidence.writeIntent.atomRefs[0]?.atomCid, 'atm-broker-classify-explicit-mutation-request-broker-841-878');
    rmSync(tempDir, { recursive: true, force: true });
    console.log('ok: bounded region produces stable synthetic atom cid');
}
function testRearbitrationProjectionCapturesEffectiveDecision() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-team-lane-'));
    const first = evaluateTeamBrokerLane({
        cwd: tempDir,
        taskId: 'TASK-A',
        actorId: 'actor-a',
        task: {
            workItemId: 'TASK-A',
            title: 'lane a',
            atomizationImpact: { ownerAtomOrMap: 'atm.owner.a' },
            proposalAdmission: {
                trigger: 'same-file-overlap-risk',
                summarySubmitted: true,
                boundedRegions: [{ filePath: 'packages/cli/src/commands/broker.ts', lineStart: 10, lineEnd: 20 }]
            }
        },
        writePaths: ['packages/cli/src/commands/broker.ts'],
        registryPath: path.join(tempDir, 'write-broker.registry.json')
    });
    const second = evaluateTeamBrokerLane({
        cwd: tempDir,
        taskId: 'TASK-B',
        actorId: 'actor-b',
        task: {
            workItemId: 'TASK-B',
            title: 'lane b',
            atomizationImpact: { ownerAtomOrMap: 'atm.owner.b' },
            proposalAdmission: {
                trigger: 'same-file-overlap-risk',
                summarySubmitted: true,
                boundedRegions: [{ filePath: 'packages/cli/src/commands/broker.ts', lineStart: 30, lineEnd: 40 }]
            }
        },
        writePaths: ['packages/cli/src/commands/broker.ts'],
        registryPath: path.join(tempDir, 'write-broker.registry.json')
    });
    const registry = registerIntent(registerIntent({
        schemaId: 'atm.writeBrokerRegistry.v1',
        specVersion: '0.1.0',
        repoId: 'test',
        workspaceId: 'main',
        activeIntents: []
    }, first.evidence.writeIntent, first.evidence.decision.lane, 1800, first.evidence.decision.admission), second.evidence.writeIntent, second.evidence.decision.lane, 1800, second.evidence.decision.admission);
    const firstActive = registry.activeIntents.find((entry) => entry.taskId === 'TASK-A');
    assert.ok(firstActive);
    const projection = projectTeamBrokerRearbitrationSnapshot({
        activeIntent: firstActive,
        registry,
        triggerTaskId: 'TASK-B',
        triggerActorId: 'actor-b'
    });
    assert.equal(projection.triggerTaskId, 'TASK-B');
    assert.equal(projection.triggerActorId, 'actor-b');
    assert.equal(projection.registeredLane, 'direct-brokered');
    assert.equal(projection.effectiveDecision.taskId, 'TASK-A');
    rmSync(tempDir, { recursive: true, force: true });
    console.log('ok: rearbitration projection captures effective decision');
}
testHotFileRequiresProposalFirstAdmission();
testBoundedRegionProducesStableSyntheticAtomCid();
testRearbitrationProjectionCapturesEffectiveDecision();
console.log('team lane tests: ok');
