import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAtmGit } from '../git-governance.js';
import { createEmergencyLease } from '../emergency/leases.js';
import { CliError } from '../shared.js';
function runGit(cwd, args) {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
}
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-git-hook-bypass-broker-'));
try {
    runGit(repo, ['init']);
    runGit(repo, ['config', 'user.name', 'Fixture Agent']);
    runGit(repo, ['config', 'user.email', 'fixture@example.com']);
    runGit(repo, ['commit', '--allow-empty', '--no-verify', '-m', 'chore: baseline']);
    const taskId = 'TASK-BROKER-CONFLICT';
    const taskPath = path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`);
    mkdirSync(path.dirname(taskPath), { recursive: true });
    writeFileSync(taskPath, `${JSON.stringify({
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: taskId,
        title: 'Broker conflict fixture',
        status: 'running',
        owner: 'broker-owner',
        scopePaths: ['src/broker-owned.ts'],
        deliverables: ['src/broker-owned.ts'],
        claim: {
            state: 'active',
            actorId: 'broker-owner',
            leaseId: 'lease-broker-conflict',
            files: ['src/broker-owned.ts'],
            heartbeatAt: new Date().toISOString(),
            ttlSeconds: 1800
        }
    }, null, 2)}\n`, 'utf8');
    mkdirSync(path.join(repo, 'src'), { recursive: true });
    writeFileSync(path.join(repo, 'src', 'broker-owned.ts'), 'export const brokerOwned = true;\n', 'utf8');
    runGit(repo, ['add', 'src/broker-owned.ts']);
    const { lease: hookBypassLease } = createEmergencyLease({
        cwd: repo,
        taskId: null,
        actorId: 'fixture-agent',
        permission: 'backend.gitHookBypass',
        approvedBy: 'fixture-human',
        approvalText: 'Human fixture approval for hook bypass regression validation.',
        reason: 'Validate that hook bypass cannot override Team Broker conflict ownership.',
        surface: 'git commit --no-verify',
        allowedFlags: ['--no-verify'],
        ttlMinutes: 10,
        maxUses: 1
    });
    await assert.rejects(() => runAtmGit([
        'commit',
        '--cwd',
        repo,
        '--actor',
        'fixture-agent',
        '--message',
        'chore: blocked broker conflict bypass',
        '--no-verify',
        '--emergency-approval',
        hookBypassLease.leaseId
    ]), (error) => {
        assert(error instanceof CliError);
        assert.equal(error.code, 'ATM_GIT_COMMIT_BROKER_CONFLICT_OVERRIDE_REQUIRED');
        const details = error.details;
        assert.equal(details.conflictTaskId, taskId);
        assert.deepEqual(details.conflictFiles, ['src/broker-owned.ts']);
        assert.equal(details.hookBypassPermission, 'backend.gitHookBypass');
        return true;
    });
    const { lease: secondHookBypassLease } = createEmergencyLease({
        cwd: repo,
        taskId: null,
        actorId: 'fixture-agent',
        permission: 'backend.gitHookBypass',
        approvedBy: 'fixture-human',
        approvalText: 'Human fixture approval for hook bypass after broker conflict resolution.',
        reason: 'Validate high-authority broker conflict override integration.',
        surface: 'git commit --no-verify',
        allowedFlags: ['--no-verify'],
        ttlMinutes: 10,
        maxUses: 1
    });
    const { lease: brokerOverrideLease } = createEmergencyLease({
        cwd: repo,
        taskId: null,
        actorId: 'fixture-agent',
        permission: 'backend.brokerConflictOverride',
        approvedBy: 'fixture-human',
        approvalText: 'Human fixture approval for high-authority Team Broker conflict override.',
        reason: 'Validate that broker conflict override requires a recorded paper-style resolution artifact.',
        surface: 'git commit broker-conflict override',
        allowedFlags: ['--broker-conflict-override'],
        ttlMinutes: 5,
        maxUses: 1
    });
    const resolutionPath = path.join(repo, '.atm', 'runtime', 'broker-conflict-resolution.json');
    mkdirSync(path.dirname(resolutionPath), { recursive: true });
    writeFileSync(resolutionPath, `${JSON.stringify({
        schemaId: 'atm.brokerConflictResolution.v1',
        conflictTaskId: taskId,
        conflictFiles: ['src/broker-owned.ts'],
        resolutionOrder: ['fixture-agent-delivery', taskId],
        ownerAcknowledgement: {
            mode: 'timeout',
            waitedUntil: new Date().toISOString()
        },
        validatorPlan: [
            'node --experimental-strip-types packages/cli/src/commands/__tests__/git-hook-bypass-broker-conflict.spec.ts'
        ]
    }, null, 2)}\n`, 'utf8');
    const overrideCommit = await runAtmGit([
        'commit',
        '--cwd',
        repo,
        '--actor',
        'fixture-agent',
        '--name',
        'Fixture Agent',
        '--email',
        'fixture@example.com',
        '--message',
        'chore: broker conflict override fixture',
        '--no-verify',
        '--emergency-approval',
        secondHookBypassLease.leaseId,
        '--broker-conflict-override',
        brokerOverrideLease.leaseId,
        '--broker-conflict-resolution',
        resolutionPath
    ]);
    assert.equal(overrideCommit.ok, true);
    assert.equal(String(overrideCommit.evidence?.commitSha ?? '').length, 40);
}
finally {
    rmSync(repo, { recursive: true, force: true });
}
