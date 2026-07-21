import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { authorizeBrokerTicket } from '../../../core/dist/broker/ticket-authority/index.js';
/**
 * Read foreign task ids authorized by a single broker conflict resolution
 * artifact for the given claiming task. Mirrors the governed commit lane.
 */
export function readResolutionAuthorizedForeignTaskIds(cwd, artifactPath, taskId) {
    if (!artifactPath?.trim())
        return new Set();
    const absolutePath = path.resolve(cwd, artifactPath);
    if (!existsSync(absolutePath))
        return new Set();
    try {
        const artifact = JSON.parse(readFileSync(absolutePath, 'utf8'));
        const primaryTaskId = String(artifact.primaryTaskId ?? '').trim().toUpperCase();
        const currentAllowedTaskId = String(artifact.currentAllowedTaskId ?? '').trim().toUpperCase();
        const blockedTaskIds = Array.isArray(artifact.blockedTaskIds)
            ? artifact.blockedTaskIds.map((value) => String(value).trim().toUpperCase()).filter(Boolean)
            : [];
        if (artifact.schemaId !== 'atm.brokerConflictResolution.v1'
            || primaryTaskId !== taskId.toUpperCase()
            || currentAllowedTaskId !== taskId.toUpperCase()) {
            return new Set();
        }
        if (!isCanonicalBrokerResolutionAuthorized(artifact, taskId)) {
            return new Set();
        }
        return new Set(blockedTaskIds);
    }
    catch {
        return new Set();
    }
}
/**
 * Merge resolution authorization from an explicit artifact path and from
 * `.atm/runtime/broker-conflict-resolutions/*.json` sidecars.
 */
export function collectResolutionAuthorizedForeignTaskIds(cwd, taskId, explicitArtifactPath) {
    const merged = new Set();
    for (const foreignTaskId of readResolutionAuthorizedForeignTaskIds(cwd, explicitArtifactPath ?? null, taskId)) {
        merged.add(foreignTaskId);
    }
    const resolutionsDir = path.join(cwd, '.atm', 'runtime', 'broker-conflict-resolutions');
    if (!existsSync(resolutionsDir)) {
        return merged;
    }
    for (const entry of readdirSync(resolutionsDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json'))
            continue;
        const relativePath = path.join('.atm', 'runtime', 'broker-conflict-resolutions', entry.name).replace(/\\/g, '/');
        for (const foreignTaskId of readResolutionAuthorizedForeignTaskIds(cwd, relativePath, taskId)) {
            merged.add(foreignTaskId);
        }
    }
    return merged;
}
export function isConflictAuthorizedByBrokerResolution(conflictingTaskId, resolutionAuthorizedForeignTaskIds) {
    const normalized = conflictingTaskId?.trim().toUpperCase();
    if (!normalized)
        return false;
    return resolutionAuthorizedForeignTaskIds.has(normalized);
}
function isCanonicalBrokerResolutionAuthorized(artifact, taskId) {
    const ticket = artifact.brokerTicket;
    if (!isBrokerTicket(ticket))
        return false;
    if (ticket.taskId.toUpperCase() !== taskId.toUpperCase())
        return false;
    const authorityGeneration = Number(artifact.authorityGeneration ?? ticket.authorityGeneration);
    const authorityDigest = String(artifact.authorityDigest ?? ticket.authorityDigest);
    const resourceKind = String(artifact.authorizationResourceKind ?? 'path');
    const resourceKeys = Array.isArray(artifact.conflictFiles)
        ? artifact.conflictFiles.map((entry) => String(entry).replace(/\\/g, '/')).filter(Boolean)
        : [];
    if (resourceKeys.length === 0)
        return false;
    return resourceKeys.every((resourceKey) => authorizeBrokerTicket(ticket, {
        resourceKind: resourceKind,
        resourceKey,
        operation: String(artifact.authorizationOperation ?? 'write'),
        gate: String(artifact.authorizationGate ?? 'git'),
        expectedAuthorityGeneration: authorityGeneration,
        expectedAuthorityDigest: authorityDigest
    }).authorized);
}
function isBrokerTicket(value) {
    return Boolean(value
        && typeof value === 'object'
        && !Array.isArray(value)
        && value.schemaId === 'atm.brokerTicket.v1'
        && typeof value.ticketId === 'string'
        && typeof value.taskId === 'string'
        && typeof value.authorityGeneration === 'number'
        && typeof value.authorityDigest === 'string'
        && Array.isArray(value.authorizationGrants));
}
