import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { relativePathFrom } from './shared.js';
const defaultTaskLedgerPolicy = {
    enabled: true,
    configuredMode: 'auto',
    provider: 'atm-local',
    mirrorExternalTasks: true,
    requireCliTransitions: true
};
export function readTaskLedgerPolicy(cwd) {
    const root = path.resolve(cwd);
    const config = readJsonIfExists(path.join(root, '.atm', 'config.json')) ?? {};
    const ledger = isPlainObject(config.taskLedger) ? config.taskLedger : {};
    const paths = isPlainObject(config.paths) ? config.paths : {};
    const configuredMode = normalizeConfiguredMode(ledger.mode);
    return {
        ...defaultTaskLedgerPolicy,
        enabled: typeof ledger.enabled === 'boolean' ? ledger.enabled : defaultTaskLedgerPolicy.enabled,
        configuredMode,
        provider: normalizeNonEmptyString(ledger.provider) ?? defaultTaskLedgerPolicy.provider,
        mirrorExternalTasks: typeof ledger.mirrorExternalTasks === 'boolean'
            ? ledger.mirrorExternalTasks
            : defaultTaskLedgerPolicy.mirrorExternalTasks,
        requireCliTransitions: typeof ledger.requireCliTransitions === 'boolean'
            ? ledger.requireCliTransitions
            : defaultTaskLedgerPolicy.requireCliTransitions,
        taskRoot: normalizeNonEmptyString(paths.tasks) ?? '.atm/history/tasks',
        eventRoot: normalizeNonEmptyString(paths.taskEvents) ?? '.atm/history/task-events',
        externalTasks: normalizeExternalTasks(ledger.externalTasks)
    };
}
export function resolveTaskLedgerMode(input) {
    if (!input.policy.enabled || input.policy.provider !== 'atm-local') {
        return 'external-provider';
    }
    if (input.policy.configuredMode !== 'auto') {
        return input.policy.configuredMode;
    }
    if (input.frameworkMode === 'required' || input.frameworkMode === 'cross-repo-target-required') {
        return 'framework-development';
    }
    return 'adopter-governed';
}
export function appendTaskTransitionEvent(input) {
    const root = path.resolve(input.cwd);
    const policy = readTaskLedgerPolicy(root);
    const createdAt = input.createdAt ?? new Date().toISOString();
    const taskJson = `${JSON.stringify(input.taskDocument, null, 2)}\n`;
    const transitionId = input.transitionId ?? createTaskTransitionId({
        createdAt,
        taskId: input.taskId,
        action: input.action,
        taskDocument: input.taskDocument
    });
    const eventRoot = path.join(root, policy.eventRoot, sanitizeTaskId(input.taskId));
    const eventAbsolute = path.join(eventRoot, `${transitionId}.json`);
    const event = {
        schemaId: 'atm.taskTransition.v1',
        specVersion: '0.1.0',
        transitionId,
        taskId: input.taskId,
        action: input.action,
        actorId: input.actorId ?? null,
        sessionId: input.sessionId ?? null,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        taskPath: relativePathFrom(root, input.taskPath),
        taskSha256: sha256(taskJson),
        createdAt,
        command: input.command ?? `atm tasks ${input.action}`,
        ...(typeof input.taskDocument.originProvider === 'string' ? { originProvider: input.taskDocument.originProvider } : {}),
        ...(typeof input.taskDocument.originTaskId === 'string' ? { originTaskId: input.taskDocument.originTaskId } : {}),
        ...(input.closureMetadata ? { closure: input.closureMetadata } : {}),
        ...(input.amendmentMetadata ? { amendmentMetadata: input.amendmentMetadata } : {})
    };
    mkdirSync(eventRoot, { recursive: true });
    writeFileSync(eventAbsolute, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
    return {
        transitionId,
        eventPath: relativePathFrom(root, eventAbsolute),
        event
    };
}
export function createTaskTransitionId(input) {
    const taskJson = `${JSON.stringify(input.taskDocument, null, 2)}\n`;
    const seed = `${input.createdAt}\n${input.taskId}\n${input.action}\n${taskJson}`;
    return `${input.createdAt.replace(/[:.]/g, '-')}-${input.action}-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
}
export function transitionEventExists(cwd, taskId, transitionId) {
    const root = path.resolve(cwd);
    const policy = readTaskLedgerPolicy(root);
    return existsSync(path.join(root, policy.eventRoot, sanitizeTaskId(taskId), `${transitionId}.json`));
}
export function externalTaskKey(provider, taskId) {
    return `${provider.trim().toLowerCase()}::${taskId.trim().toLowerCase()}`;
}
export function defaultMirrorTaskId(provider, originTaskId) {
    const providerToken = provider.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'EXT';
    const originToken = originTaskId.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'TASK';
    return `MIRROR-${providerToken}-${originToken}`;
}
function normalizeConfiguredMode(value) {
    const normalized = String(value ?? 'auto').trim().toLowerCase().replace(/_/g, '-');
    if (normalized === 'adopter-governed' || normalized === 'framework-development' || normalized === 'external-provider') {
        return normalized;
    }
    return 'auto';
}
function normalizeExternalTasks(value) {
    if (!Array.isArray(value))
        return [];
    return value.flatMap((entry) => {
        if (!isPlainObject(entry))
            return [];
        const provider = normalizeNonEmptyString(entry.provider);
        const taskId = normalizeNonEmptyString(entry.taskId ?? entry.originTaskId);
        if (!provider || !taskId)
            return [];
        return [{
                provider,
                taskId,
                url: normalizeNonEmptyString(entry.url ?? entry.originUrl)
            }];
    });
}
function readJsonIfExists(filePath) {
    if (!existsSync(filePath))
        return null;
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    }
    catch {
        return null;
    }
}
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function normalizeNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
function sanitizeTaskId(taskId) {
    return taskId.trim().replace(/[^A-Za-z0-9._-]+/g, '-');
}
function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
