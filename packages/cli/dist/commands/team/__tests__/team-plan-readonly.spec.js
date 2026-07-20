import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadRegistry, saveRegistry } from '../../../../../core/dist/broker/registry.js';
import { buildProposalFirstParityFindings, planTeamBrokerLane, readActiveTaskClaimActorId, resolveTeamPlanActorId } from '../../team.js';
const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'atm-team-plan-readonly-'));
function writeTask(taskId, claim) {
    const taskDir = path.join(fixtureRoot, '.atm', 'history', 'tasks');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(path.join(taskDir, `${taskId}.json`), JSON.stringify({
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: taskId,
        status: 'running',
        claim
    }, null, 2), 'utf8');
}
function testRegistryPersistCleanupSkippedInReadOnly() {
    const registryPath = path.join(fixtureRoot, 'broker-registry.json');
    const staleIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    saveRegistry(registryPath, {
        schemaId: 'atm.writeBrokerRegistry.v1',
        specVersion: '0.1.0',
        repoId: 'local-repo',
        workspaceId: 'main',
        currentEpoch: 1,
        activeIntents: [
            {
                intentId: 'intent-stale',
                taskId: 'TASK-STALE',
                actorId: 'other-actor',
                lane: 'serial',
                leaseEpoch: 1,
                createdAt: staleIso,
                expiresAt: staleIso,
                writeSet: ['packages/cli/src/commands/team.ts'],
                readSet: [],
                sourceAtomIds: [],
                admission: {
                    trigger: 'not-required',
                    state: 'not-required',
                    requiresProposal: false,
                    summarySubmitted: false,
                    hotFiles: [],
                    boundedRegions: []
                }
            }
        ]
    });
    const before = readFileSync(registryPath, 'utf8');
    const cleaned = loadRegistry(registryPath, { persistCleanup: false });
    assert.equal(cleaned.activeIntents.length, 0, 'in-memory cleanup should drop stale intents');
    assert.equal(readFileSync(registryPath, 'utf8'), before, 'read-only load must not persist cleanup');
}
function testProposalFirstBecomesWarningWhenAdvisory() {
    const brokerLaneResult = {
        ok: false,
        evidence: {
            decision: {
                admission: {
                    state: 'proposal-submitted',
                    hotFiles: ['packages/cli/src/commands/team.ts']
                }
            }
        }
    };
    const hard = buildProposalFirstParityFindings({
        taskId: 'TASK-AAO-0195',
        brokerLaneResult
    });
    assert.equal(hard[0].level, 'error');
    const soft = buildProposalFirstParityFindings({
        taskId: 'TASK-AAO-0195',
        brokerLaneResult,
        advisoryOnly: true
    });
    assert.equal(soft[0].level, 'warning');
    assert.match(soft[0].detail, /Read-only team plan projection/);
}
function testPlanLanePassesReadOnlyToRegistry() {
    const defaultRegistry = path.join(fixtureRoot, '.atm', 'runtime', 'write-broker.registry.json');
    mkdirSync(path.dirname(defaultRegistry), { recursive: true });
    const staleIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    saveRegistry(defaultRegistry, {
        schemaId: 'atm.writeBrokerRegistry.v1',
        specVersion: '0.1.0',
        repoId: 'local-repo',
        workspaceId: 'main',
        currentEpoch: 1,
        activeIntents: [
            {
                intentId: 'intent-stale-2',
                taskId: 'TASK-STALE-2',
                actorId: 'other-actor',
                lane: 'serial',
                leaseEpoch: 1,
                createdAt: staleIso,
                expiresAt: staleIso,
                writeSet: ['docs/governance/atm-bug-and-optimization-backlog.md'],
                readSet: [],
                sourceAtomIds: [],
                admission: {
                    trigger: 'not-required',
                    state: 'not-required',
                    requiresProposal: false,
                    summarySubmitted: false,
                    hotFiles: [],
                    boundedRegions: []
                }
            }
        ]
    });
    const before = readFileSync(defaultRegistry, 'utf8');
    planTeamBrokerLane({
        cwd: fixtureRoot,
        taskId: 'TASK-AAO-0195',
        actorId: 'cursor-grok-4.5',
        task: {
            workItemId: 'TASK-AAO-0195',
            allowedFiles: ['docs/governance/atm-bug-and-optimization-backlog.md']
        },
        writePaths: ['docs/governance/atm-bug-and-optimization-backlog.md'],
        readOnly: true
    });
    assert.equal(readFileSync(defaultRegistry, 'utf8'), before, 'read-only plan must not persist broker registry cleanup');
}
function testActorResolutionPrefersActiveClaim() {
    writeTask('TASK-CLAIM-ACTOR', {
        actorId: 'claim-owner',
        leaseId: 'lease-1',
        claimedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        ttlSeconds: 1800,
        state: 'active'
    });
    assert.equal(readActiveTaskClaimActorId(fixtureRoot, 'TASK-CLAIM-ACTOR'), 'claim-owner');
    assert.equal(resolveTeamPlanActorId({
        cwd: fixtureRoot,
        taskId: 'TASK-CLAIM-ACTOR',
        explicitActorId: '',
        fallbackActorId: 'stale-env-actor'
    }), 'claim-owner');
    assert.equal(resolveTeamPlanActorId({
        cwd: fixtureRoot,
        taskId: 'TASK-CLAIM-ACTOR',
        explicitActorId: 'explicit-actor',
        fallbackActorId: 'stale-env-actor'
    }), 'explicit-actor');
}
testRegistryPersistCleanupSkippedInReadOnly();
testProposalFirstBecomesWarningWhenAdvisory();
testPlanLanePassesReadOnlyToRegistry();
testActorResolutionPrefersActiveClaim();
console.log('team-plan-readonly.spec.ts: ok');
