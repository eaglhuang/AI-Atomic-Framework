import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../shared.js';
import { getEmergencyPermission } from './registry.js';
export function emergencyRoot(cwd) {
    return path.join(path.resolve(cwd), '.atm', 'runtime', 'emergency');
}
function leasesDir(cwd) {
    return path.join(emergencyRoot(cwd), 'leases');
}
function usesDir(cwd) {
    return path.join(emergencyRoot(cwd), 'uses');
}
function leasePath(cwd, leaseId) {
    return path.join(leasesDir(cwd), `${leaseId}.json`);
}
function writeJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return filePath;
}
function shortHash(value) {
    return createHash('sha256').update(value).digest('hex').slice(0, 10);
}
export function createEmergencyLease(input) {
    const permission = getEmergencyPermission(input.permission);
    if (!permission) {
        throw new CliError('ATM_EMERGENCY_PERMISSION_UNKNOWN', `Unknown emergency permission: ${input.permission}`, {
            exitCode: 2,
            details: { permission: input.permission }
        });
    }
    if (!input.approvalText.trim()) {
        throw new CliError('ATM_EMERGENCY_APPROVAL_TEXT_REQUIRED', 'emergency approve requires --approval-text with the human approval sentence.', { exitCode: 2 });
    }
    if (!input.reason.trim()) {
        throw new CliError('ATM_EMERGENCY_REASON_REQUIRED', 'emergency approve requires --reason.', { exitCode: 2 });
    }
    const createdAt = new Date();
    const ttlMinutes = input.ttlMinutes ?? permission.defaultTtlMinutes;
    const expiresAt = new Date(createdAt.getTime() + ttlMinutes * 60_000);
    const seed = `${input.taskId ?? 'global'}:${input.actorId}:${permission.id}:${createdAt.toISOString()}:${randomUUID()}`;
    const lease = {
        schemaId: 'atm.emergencyMaintenanceLease.v1',
        leaseId: `EMG-${input.taskId ?? 'GLOBAL'}-${shortHash(seed)}`,
        taskId: input.taskId,
        actorId: input.actorId,
        permission: permission.id,
        approvedBy: input.approvedBy,
        approvalText: input.approvalText.trim(),
        reason: input.reason.trim(),
        surface: input.surface?.trim() || null,
        allowedFlags: input.allowedFlags,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        maxUses: input.maxUses ?? permission.defaultMaxUses,
        usedCount: 0,
        status: 'active',
        revokedAt: null,
        revokedBy: null
    };
    return { lease, path: writeJson(leasePath(input.cwd, lease.leaseId), lease) };
}
export function readEmergencyLease(cwd, leaseId) {
    const filePath = leasePath(cwd, leaseId);
    if (!existsSync(filePath)) {
        throw new CliError('ATM_EMERGENCY_APPROVAL_NOT_FOUND', `Emergency approval lease not found: ${leaseId}`, {
            exitCode: 1,
            details: { leaseId }
        });
    }
    return JSON.parse(readFileSync(filePath, 'utf8'));
}
export function listEmergencyLeases(cwd) {
    const dir = leasesDir(cwd);
    if (!existsSync(dir))
        return [];
    return readdirSync(dir)
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => JSON.parse(readFileSync(path.join(dir, entry), 'utf8')))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function revokeEmergencyLease(input) {
    const current = readEmergencyLease(input.cwd, input.leaseId);
    const lease = {
        ...current,
        status: 'revoked',
        revokedAt: new Date().toISOString(),
        revokedBy: input.actorId
    };
    return { lease, path: writeJson(leasePath(input.cwd, lease.leaseId), lease) };
}
export function consumeEmergencyLease(input) {
    const lease = readEmergencyLease(input.cwd, input.leaseId);
    if (lease.status !== 'active') {
        throw new CliError('ATM_EMERGENCY_APPROVAL_REVOKED', `Emergency approval lease is not active: ${lease.leaseId}`, { exitCode: 1, details: { leaseId: lease.leaseId, status: lease.status } });
    }
    if (lease.permission !== input.permission) {
        throw new CliError('ATM_EMERGENCY_PERMISSION_MISMATCH', `Emergency approval ${lease.leaseId} is for ${lease.permission}, not ${input.permission}.`, { exitCode: 1, details: { leaseId: lease.leaseId, permission: lease.permission, requiredPermission: input.permission } });
    }
    if (lease.taskId && input.taskId && lease.taskId !== input.taskId) {
        throw new CliError('ATM_EMERGENCY_TASK_MISMATCH', `Emergency approval ${lease.leaseId} is for ${lease.taskId}, not ${input.taskId}.`, { exitCode: 1, details: { leaseId: lease.leaseId, taskId: input.taskId, leaseTaskId: lease.taskId } });
    }
    if (input.actorId && lease.actorId !== input.actorId) {
        throw new CliError('ATM_EMERGENCY_ACTOR_MISMATCH', `Emergency approval ${lease.leaseId} is for actor ${lease.actorId}, not ${input.actorId}.`, { exitCode: 1, details: { leaseId: lease.leaseId, actorId: input.actorId, leaseActorId: lease.actorId } });
    }
    if (Date.parse(lease.expiresAt) <= Date.now()) {
        throw new CliError('ATM_EMERGENCY_APPROVAL_EXPIRED', `Emergency approval lease expired: ${lease.leaseId}`, { exitCode: 1, details: { leaseId: lease.leaseId, expiresAt: lease.expiresAt } });
    }
    if (lease.usedCount >= lease.maxUses) {
        throw new CliError('ATM_EMERGENCY_APPROVAL_EXHAUSTED', `Emergency approval lease has no remaining uses: ${lease.leaseId}`, { exitCode: 1, details: { leaseId: lease.leaseId, maxUses: lease.maxUses } });
    }
    const disallowedFlag = input.flags.find((flag) => !lease.allowedFlags.includes(flag));
    if (disallowedFlag) {
        throw new CliError('ATM_EMERGENCY_FLAG_NOT_APPROVED', `Emergency approval ${lease.leaseId} does not allow ${disallowedFlag}.`, { exitCode: 1, details: { leaseId: lease.leaseId, disallowedFlag, allowedFlags: lease.allowedFlags } });
    }
    const updated = {
        ...lease,
        usedCount: lease.usedCount + 1
    };
    const usedAt = new Date().toISOString();
    const use = {
        schemaId: 'atm.emergencyMaintenanceUse.v1',
        leaseId: lease.leaseId,
        taskId: input.taskId,
        actorId: input.actorId,
        permission: input.permission,
        surface: input.surface,
        usedAt,
        reason: input.reason,
        command: input.command
    };
    const usePath = path.join(usesDir(input.cwd), `${usedAt.replace(/[:.]/g, '-')}-${lease.leaseId}.json`);
    return {
        lease: updated,
        use,
        leasePath: writeJson(leasePath(input.cwd, lease.leaseId), updated),
        usePath: writeJson(usePath, use)
    };
}
