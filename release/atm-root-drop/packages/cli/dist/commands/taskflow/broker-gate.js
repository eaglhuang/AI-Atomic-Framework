import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadRegistry } from '../../../../core/dist/broker/registry.js';
import { calculateBrokerDecision } from '../../../../core/dist/broker/decision.js';
import { resolveCanonicalDecisionClass } from '../broker/replay/closure-policy.js';
import { quoteCliValue } from '../shared.js';
function uniqueTaskIds(values) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
function wildcardToRegExp(pattern) {
    const normalizedPattern = pattern.replace(/\\/g, '/');
    const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regexSource = `^${escaped.replace(/\*\*/g, '::DOUBLE_STAR::').replace(/\*/g, '[^/]*').replace(/::DOUBLE_STAR::/g, '.*')}$`;
    return new RegExp(regexSource);
}
function brokerPathMatches(filePath, declaredPath) {
    const file = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const declared = declaredPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (!file || !declared)
        return false;
    if (declared.includes('*')) {
        return wildcardToRegExp(declared).test(file);
    }
    return file === declared || file.startsWith(`${declared}/`);
}
function buildBrokerConflictResolveCommand(taskId, overlappingTaskIds, declaredFiles) {
    const conflictTaskId = overlappingTaskIds[0];
    const sharedPath = declaredFiles[0];
    if (!conflictTaskId || !sharedPath)
        return null;
    return `node atm.mjs team broker resolve --task ${taskId} --conflict ${conflictTaskId} --path ${quoteCliValue(sharedPath)} --decision-reason "broker-conflict-blocked until the release order grants the next task." --json`;
}
function noConflictGate(summary, brokerVerdict = null) {
    return {
        schemaId: 'atm.taskflowBrokerConflictGate.v1',
        verdict: 'noConflict',
        confirmedConflict: false,
        overlappingTaskIds: [],
        summary,
        requiredCommand: null,
        brokerVerdict,
        decisionClass: null,
        decisionReason: null,
        violationStatus: null,
        statusCode: null
    };
}
function activeIntentToWriteIntent(intent) {
    const rangeByCid = new Map();
    for (const range of intent.resourceKeys.atomRanges ?? []) {
        const bucket = rangeByCid.get(range.atomCid) ?? [];
        bucket.push(range);
        rangeByCid.set(range.atomCid, bucket);
    }
    const atomRefs = intent.resourceKeys.atomIds.map((atomId, index) => {
        const atomCid = intent.resourceKeys.atomCids[index] ?? atomId;
        const range = rangeByCid.get(atomCid)?.[0];
        return {
            atomId,
            atomCid,
            operation: 'modify',
            ...(range ? {
                sourceRange: {
                    filePath: range.filePath,
                    lineStart: range.lineStart,
                    lineEnd: range.lineEnd
                }
            } : {})
        };
    }).filter((ref) => ref.atomId && ref.atomCid);
    return {
        schemaId: 'atm.writeIntent.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'derived-from-active-broker-intent' },
        taskId: intent.taskId,
        actorId: intent.actorId,
        baseCommit: intent.baseCommit,
        targetFiles: intent.resourceKeys.files,
        atomRefs,
        sharedSurfaces: {
            generators: intent.resourceKeys.generators,
            projections: intent.resourceKeys.projections,
            registries: intent.resourceKeys.registries,
            validators: intent.resourceKeys.validators,
            artifacts: intent.resourceKeys.artifacts
        },
        requestedLane: intent.lane
    };
}
export function evaluateTaskflowBrokerConflictGate(input) {
    const registryPath = path.join(input.cwd, '.atm', 'runtime', 'write-broker.registry.json');
    const currentFiles = [...input.declaredFiles];
    if (!existsSync(registryPath) || currentFiles.length === 0) {
        return noConflictGate('No broker conflict evidence is available for this close.');
    }
    const registry = loadRegistry(registryPath);
    const currentIntent = registry.activeIntents.find((entry) => entry.taskId === input.taskId) ?? null;
    const overlapping = registry.activeIntents.filter((entry) => entry.taskId !== input.taskId
        && entry.resourceKeys.files.some((entryFile) => currentFiles.some((file) => brokerPathMatches(file, entryFile) || brokerPathMatches(entryFile, file))));
    const staleEpochOverlap = typeof registry.currentEpoch === 'number'
        ? overlapping.filter((entry) => typeof entry.leaseEpoch === 'number' && entry.leaseEpoch < registry.currentEpoch)
        : [];
    if (overlapping.length === 0) {
        return noConflictGate('No overlapping broker-tracked write intents affect this close.');
    }
    if (staleEpochOverlap.length > 0) {
        const repairTarget = staleEpochOverlap[0]?.taskId ?? null;
        const actorId = input.actorId?.trim() || currentIntent?.actorId || '<actor>';
        return {
            schemaId: 'atm.taskflowBrokerConflictGate.v1',
            verdict: 'takeoverRequired',
            confirmedConflict: false,
            overlappingTaskIds: staleEpochOverlap.map((entry) => entry.taskId),
            summary: `Broker found stale or malformed active lease epoch state (${staleEpochOverlap.map((entry) => entry.taskId).join(', ')}). Repair or take over the stale broker lane before continuing, so shared hot files do not fall through to hook-time scope drift.`,
            requiredCommand: repairTarget
                ? `node atm.mjs tasks repair-claim --task ${repairTarget} --actor ${quoteCliValue(actorId)} --json`
                : null,
            brokerVerdict: 'blocked-active-lease',
            decisionClass: 'blocked',
            decisionReason: 'broker-conflict-blocked because broker found stale or malformed active lease state before close.',
            violationStatus: 'broker-conflict-blocked',
            statusCode: 'broker-conflict-blocked'
        };
    }
    if (!currentIntent) {
        return {
            schemaId: 'atm.taskflowBrokerConflictGate.v1',
            verdict: 'insufficientMutationIntent',
            confirmedConflict: false,
            overlappingTaskIds: overlapping.map((entry) => entry.taskId),
            summary: 'broker-conflict-blocked: Broker found overlapping active write intents, but this task has no registered broker mutation intent or resolution artifact to prove a safe release order.',
            requiredCommand: buildBrokerConflictResolveCommand(input.taskId, overlapping.map((entry) => entry.taskId), currentFiles),
            brokerVerdict: null,
            decisionClass: 'blocked',
            decisionReason: 'broker-conflict-blocked because active task overlap lacks a registered mutation intent or resolution artifact.',
            violationStatus: 'broker-conflict-blocked',
            statusCode: 'broker-conflict-blocked',
            brokerTicket: buildTaskflowBrokerTicket(input.taskId, overlapping)
        };
    }
    const currentWriteIntent = activeIntentToWriteIntent(currentIntent);
    if (currentWriteIntent.atomRefs.length === 0) {
        return {
            schemaId: 'atm.taskflowBrokerConflictGate.v1',
            verdict: 'insufficientMutationIntent',
            confirmedConflict: false,
            overlappingTaskIds: overlapping.map((entry) => entry.taskId),
            summary: 'broker-conflict-blocked: Broker found overlapping active write intents, but the registered mutation intent lacks atom-level detail or a resolution artifact.',
            requiredCommand: buildBrokerConflictResolveCommand(input.taskId, overlapping.map((entry) => entry.taskId), currentFiles),
            brokerVerdict: null,
            decisionClass: 'blocked',
            decisionReason: 'broker-conflict-blocked because active task overlap lacks atom-level mutation intent or resolution artifact.',
            violationStatus: 'broker-conflict-blocked',
            statusCode: 'broker-conflict-blocked',
            brokerTicket: buildTaskflowBrokerTicket(input.taskId, overlapping)
        };
    }
    const comparisonRegistry = {
        ...registry,
        activeIntents: overlapping
    };
    const decision = calculateBrokerDecision(currentWriteIntent, comparisonRegistry);
    if (decision.verdict === 'blocked-cid-conflict') {
        return {
            schemaId: 'atm.taskflowBrokerConflictGate.v1',
            verdict: 'confirmedConflict',
            confirmedConflict: true,
            overlappingTaskIds: overlapping.map((entry) => entry.taskId),
            summary: 'Broker reports a confirmed CID/read-set conflict with another active write intent. taskflow close --write must stop until the conflict is resolved.',
            requiredCommand: buildBrokerConflictResolveCommand(input.taskId, overlapping.map((entry) => entry.taskId), currentFiles),
            brokerVerdict: decision.verdict,
            decisionClass: 'serial-release',
            decisionReason: 'broker-conflict-blocked because Broker reports a confirmed CID/read-set conflict with another active write intent.',
            violationStatus: 'broker-conflict-blocked',
            statusCode: 'broker-conflict-blocked',
            brokerTicket: buildTaskflowBrokerTicket(input.taskId, overlapping, true)
        };
    }
    if (decision.verdict === 'blocked-active-lease') {
        const staleLeaseBlockingTasks = uniqueTaskIds((decision.conflictMatrix?.conflicts ?? [])
            .filter((entry) => entry.kind === 'lease' && typeof entry.blockingTask === 'string' && entry.blockingTask !== 'self')
            .map((entry) => entry.blockingTask));
        const repairTarget = staleLeaseBlockingTasks[0] ?? overlapping[0]?.taskId ?? null;
        const actorId = input.actorId?.trim() || currentIntent.actorId || '<actor>';
        return {
            schemaId: 'atm.taskflowBrokerConflictGate.v1',
            verdict: 'takeoverRequired',
            confirmedConflict: false,
            overlappingTaskIds: overlapping.map((entry) => entry.taskId),
            summary: staleLeaseBlockingTasks.length > 0
                ? `Broker found stale or malformed active lease state (${staleLeaseBlockingTasks.join(', ')}). Repair or take over the stale broker lane before continuing, so shared hot files do not fall through to hook-time scope drift.`
                : 'Broker found stale or malformed active lease state. Repair or take over the stale broker lane before continuing, so shared hot files do not fall through to hook-time scope drift.',
            requiredCommand: repairTarget
                ? `node atm.mjs tasks repair-claim --task ${repairTarget} --actor ${quoteCliValue(actorId)} --json`
                : null,
            brokerVerdict: decision.verdict,
            decisionClass: 'blocked',
            decisionReason: 'broker-conflict-blocked because broker found stale or malformed active lease state before close.',
            violationStatus: 'broker-conflict-blocked',
            statusCode: 'broker-conflict-blocked'
        };
    }
    const canonicalDecisionClass = resolveCanonicalDecisionClass({
        verdict: decision.verdict,
        admissionState: decision.admission?.state ?? null
    });
    if (decision.verdict === 'needs-physical-split' && canonicalDecisionClass === 'composer-routed') {
        return {
            ...noConflictGate('Broker reports composer-routed disjoint same-file regions; path equality alone must not serialize this close.', decision.verdict),
            overlappingTaskIds: overlapping.map((entry) => entry.taskId),
            decisionClass: 'composer-routed',
            decisionReason: 'composer-routed admission remains authoritative even when the legacy top-level verdict is needs-physical-split.'
        };
    }
    if (decision.verdict === 'needs-physical-split' || decision.verdict === 'blocked-shared-surface') {
        return {
            schemaId: 'atm.taskflowBrokerConflictGate.v1',
            verdict: 'insufficientMutationIntent',
            confirmedConflict: false,
            overlappingTaskIds: overlapping.map((entry) => entry.taskId),
            summary: 'broker-conflict-blocked: Broker found overlapping write surfaces without a confirmed safe release artifact.',
            requiredCommand: buildBrokerConflictResolveCommand(input.taskId, overlapping.map((entry) => entry.taskId), currentFiles),
            brokerVerdict: decision.verdict,
            decisionClass: canonicalDecisionClass === 'must-serialize' ? 'serial-release' : 'blocked',
            decisionReason: 'broker-conflict-blocked because active write surfaces overlap without a resolution artifact.',
            violationStatus: 'broker-conflict-blocked',
            statusCode: 'broker-conflict-blocked',
            brokerTicket: buildTaskflowBrokerTicket(input.taskId, overlapping, decision.verdict === 'blocked-shared-surface')
        };
    }
    return {
        ...noConflictGate('Broker re-check found no confirmed CID conflict for this close.', decision.verdict),
        overlappingTaskIds: overlapping.map((entry) => entry.taskId),
        decisionClass: canonicalDecisionClass === 'composer-routed' ? 'composer-routed' : null
    };
}
function buildTaskflowBrokerTicket(taskId, overlapping, batchEligible = false) {
    const head = [...overlapping].sort((left, right) => left.heartbeatAt.localeCompare(right.heartbeatAt))[0] ?? null;
    const enqueuedAt = head?.heartbeatAt ?? new Date().toISOString();
    const waitedMs = Math.max(0, Date.now() - Date.parse(enqueuedAt));
    return {
        schemaId: 'atm.brokerTicket.v1',
        ticketId: `shared-surface:${taskId}:${head?.taskId ?? 'unknown'}`,
        position: 2,
        headOwner: head?.taskId ?? null,
        headHealth: 'task-active',
        batchEligible,
        enqueuedAt,
        waitedMs: Number.isFinite(waitedMs) ? waitedMs : 0,
        sharedSurface: 'broker-shared-surface',
        scopeClass: ['code']
    };
}
