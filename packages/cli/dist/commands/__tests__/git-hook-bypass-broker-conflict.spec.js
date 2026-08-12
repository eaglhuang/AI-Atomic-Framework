import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBrokerConflictResolutionArtifact } from '../../../../core/dist/team-runtime/permission-broker.js';
import { readBrokerConflictResolutionArtifact } from '../git-governance/implementation/broker-hook-bypass-preflight.js';
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-git-hook-bypass-broker-'));
const conflictTaskId = 'TASK-BROKER-CONFLICT';
const conflictFiles = ['src/broker-owned.ts'];
function writeArtifact(name, value) {
    const artifactPath = path.join(repo, '.atm', 'runtime', name);
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return artifactPath;
}
try {
    const productionPath = writeArtifact('production-resolution.json', createBrokerConflictResolutionArtifact({
        primaryTaskId: 'TASK-DELIVERY',
        conflictingTaskIds: [conflictTaskId],
        sharedPaths: conflictFiles,
        decisionReason: 'The current task delivers first, then the conflicting task revalidates.',
        releaseOrder: ['TASK-DELIVERY', conflictTaskId]
    }));
    const production = readBrokerConflictResolutionArtifact({
        cwd: repo,
        artifactPath: productionPath,
        conflictTaskId,
        conflictFiles
    });
    assert.equal(production.artifact.schemaId, 'atm.brokerConflictResolution.v1');
    const legacyPath = writeArtifact('legacy-resolution.json', {
        schemaId: 'atm.brokerConflictResolution.v1',
        conflictTaskId,
        conflictFiles,
        resolutionOrder: ['TASK-DELIVERY', conflictTaskId],
        validatorPlan: ['node atm.mjs evidence verify --task TASK-DELIVERY --gate commit --json'],
        decisionClass: 'serial-release',
        decisionReason: 'Legacy artifact remains supported while the producer migrates.',
        violationStatus: 'resolution-issued'
    });
    const legacy = readBrokerConflictResolutionArtifact({
        cwd: repo,
        artifactPath: legacyPath,
        conflictTaskId,
        conflictFiles
    });
    assert.equal(legacy.artifact.schemaId, 'atm.brokerConflictResolution.v1');
}
finally {
    rmSync(repo, { recursive: true, force: true });
}
console.log('[git-hook-bypass-broker-conflict] ok');
