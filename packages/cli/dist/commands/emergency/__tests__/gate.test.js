import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertEmergencyApproval } from '../gate.js';
import { CliError } from '../../shared.js';
function writeLease(repo, input) {
    const filePath = path.join(repo, '.atm', 'runtime', 'emergency', 'leases', `${input.leaseId}.json`);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify({
        schemaId: 'atm.emergencyMaintenanceLease.v1',
        leaseId: input.leaseId,
        taskId: 'TASK-EMG-SET',
        actorId: 'validator',
        permission: input.permission,
        approvedBy: 'project-owner',
        approvalText: 'validator fixture approval',
        reason: 'validator regression',
        surface: null,
        allowedFlags: input.allowedFlags,
        createdAt: '2026-08-13T00:00:00.000Z',
        expiresAt: '2999-01-01T00:00:00.000Z',
        maxUses: 3,
        usedCount: 0,
        status: 'active'
    }, null, 2)}\n`, 'utf8');
    return input.leaseId;
}
function readLease(repo, leaseId) {
    const filePath = path.join(repo, '.atm', 'runtime', 'emergency', 'leases', `${leaseId}.json`);
    return JSON.parse(readFileSync(filePath, 'utf8'));
}
function fail(message) {
    console.error(`[emergency-gate.test] ${message}`);
    process.exitCode = 1;
    throw new Error(message);
}
function assert(condition, message) {
    if (!condition)
        fail(message);
}
// ATM-BUG-2026-07-07-051: the first emergency approve attempt must already
// know which --allowed-flag entries the lease needs, because the blocked
// command already carries the protected flags.
try {
    assertEmergencyApproval({
        cwd: process.cwd(),
        surface: 'tasks close',
        permission: 'backend.tasks.close',
        taskId: 'TASK-EMG-TEST',
        actorId: 'validator',
        emergencyApproval: null,
        flags: ['--historical-delivery'],
        reason: 'validator regression',
        command: 'node atm.mjs tasks close --task TASK-EMG-TEST --historical-delivery deadbeef --json'
    });
    fail('assertEmergencyApproval must throw when no emergency approval lease is supplied');
}
catch (error) {
    if (!(error instanceof CliError))
        throw error;
    assert(error.code === 'ATM_EMERGENCY_LANE_APPROVAL_REQUIRED', 'must fail with the emergency lane approval code');
    const details = error.details;
    assert(Array.isArray(details.requiredAllowedFlags), 'error details must expose requiredAllowedFlags');
    assert(details.requiredAllowedFlags.includes('--historical-delivery'), 'requiredAllowedFlags must include the blocked command flag');
    const requiredCommand = String(details.requiredCommand ?? '');
    assert(requiredCommand.includes('--allowed-flag --historical-delivery'), 'requiredCommand must pre-approve the blocked flag so the first lease succeeds');
    assert(String(error.message).includes('ATM_EMERGENCY_FLAG_NOT_APPROVED'), 'error message must warn that a missing --allowed-flag will fail the lease');
}
// No protected flags: requiredCommand must stay flag-free (backward compatible with existing fixtures).
try {
    assertEmergencyApproval({
        cwd: process.cwd(),
        surface: 'tasks reconcile',
        permission: 'backend.tasks.reconcile',
        taskId: 'TASK-EMG-TEST-2',
        actorId: 'validator',
        emergencyApproval: null,
        flags: [],
        reason: 'validator regression',
        command: 'node atm.mjs tasks reconcile --task TASK-EMG-TEST-2 --json'
    });
    fail('assertEmergencyApproval must throw when no emergency approval lease is supplied');
}
catch (error) {
    if (!(error instanceof CliError))
        throw error;
    const details = error.details;
    assert(Array.isArray(details.requiredAllowedFlags) && details.requiredAllowedFlags.length === 0, 'requiredAllowedFlags must stay empty when no protected flags are in play');
    assert(!String(details.requiredCommand ?? '').includes('--allowed-flag'), 'requiredCommand must not add --allowed-flag when no protected flags are used');
}
// test_atm_gov_0368_one_command_satisfies_every_permission_it_needs
// ATM-BUG-2026-08-13-025: tasks close --allow-stale-runner --historical-delivery
// selects two protected surfaces. The approval argument must be able to carry a
// lease for each, and must still refuse when none of them covers this surface.
{
    const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-emergency-set-'));
    try {
        const runnerLease = writeLease(repo, {
            leaseId: 'EMG-TASK-EMG-SET-runner',
            permission: 'backend.runnerRecovery',
            allowedFlags: ['--allow-stale-runner', '--historical-delivery']
        });
        const closeLease = writeLease(repo, {
            leaseId: 'EMG-TASK-EMG-SET-close',
            permission: 'backend.tasks.close',
            allowedFlags: ['--allow-stale-runner', '--historical-delivery']
        });
        const supplied = `${runnerLease},${closeLease}`;
        const flags = ['--allow-stale-runner', '--historical-delivery'];
        const runner = assertEmergencyApproval({
            cwd: repo,
            surface: 'tasks close stale-runner recovery',
            permission: 'backend.runnerRecovery',
            taskId: 'TASK-EMG-SET',
            actorId: 'validator',
            emergencyApproval: supplied,
            flags,
            reason: 'validator regression',
            command: 'node atm.mjs tasks close --task TASK-EMG-SET --allow-stale-runner --historical-delivery deadbeef --json'
        });
        assert(runner && runner.lease.leaseId === runnerLease, 'the runner-recovery surface must select the runner-recovery lease');
        const close = assertEmergencyApproval({
            cwd: repo,
            surface: 'tasks close',
            permission: 'backend.tasks.close',
            taskId: 'TASK-EMG-SET',
            actorId: 'validator',
            emergencyApproval: supplied,
            flags,
            reason: 'validator regression',
            command: 'node atm.mjs tasks close --task TASK-EMG-SET --allow-stale-runner --historical-delivery deadbeef --json'
        });
        assert(close && close.lease.leaseId === closeLease, 'the close surface must select the close lease from the same set');
        // Only the selected member is consumed by each call.
        assert(readLease(repo, runnerLease).usedCount === 1, 'the runner lease must be consumed exactly once');
        assert(readLease(repo, closeLease).usedCount === 1, 'the close lease must be consumed exactly once');
        // A set that covers neither surface is still refused, and the refusal names
        // every lease presented rather than only the first one checked.
        const unrelated = writeLease(repo, {
            leaseId: 'EMG-TASK-EMG-SET-import',
            permission: 'backend.tasks.import.write',
            allowedFlags: ['--force']
        });
        try {
            assertEmergencyApproval({
                cwd: repo,
                surface: 'tasks close',
                permission: 'backend.tasks.close',
                taskId: 'TASK-EMG-SET',
                actorId: 'validator',
                emergencyApproval: `${unrelated},${runnerLease}`,
                flags: [],
                reason: 'validator regression',
                command: 'node atm.mjs tasks close --task TASK-EMG-SET --json'
            });
            fail('a set covering neither surface must still be refused');
        }
        catch (error) {
            if (!(error instanceof CliError))
                throw error;
            assert(error.code === 'ATM_EMERGENCY_PERMISSION_MISMATCH', 'an uncovered surface must report a permission mismatch');
            const details = error.details;
            const supplied = details.suppliedLeases;
            assert(Array.isArray(supplied) && supplied.length === 2, 'the refusal must list every supplied lease');
            assert(supplied.some((entry) => entry.leaseId === unrelated && entry.permission === 'backend.tasks.import.write'), 'the refusal must name each lease with the permission it carries');
            assert(details.requiredPermission === 'backend.tasks.close', 'the refusal must name the permission required');
            assert(readLease(repo, runnerLease).usedCount === 1, 'a refused attempt must not consume any lease');
        }
    }
    finally {
        rmSync(repo, { recursive: true, force: true });
    }
}
console.log('[emergency-gate.test] ok');
