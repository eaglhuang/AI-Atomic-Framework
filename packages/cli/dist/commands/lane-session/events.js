import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { relativePathFrom } from '../shared.js';
import { atomicWriteJson } from './store.js';
export const historyLaneSessionEventsRootRelativePath = '.atm/history/session-events';
export function appendLaneSessionEvent(input) {
    const cwd = path.resolve(input.cwd);
    const createdAt = normalizeIsoString(input.createdAt) ?? new Date().toISOString();
    const previousEvents = listLaneSessionEvents(cwd, input.laneId);
    const sequence = previousEvents.length + 1;
    const event = {
        schemaId: 'atm.laneSessionEvent.v1',
        specVersion: '0.1.0',
        eventId: createLaneSessionEventId({
            laneId: input.laneId,
            action: input.action,
            actorId: input.actorId ?? null,
            createdAt,
            sequence
        }),
        laneId: input.laneId,
        sequence,
        action: sanitizeAction(input.action),
        actorId: normalizeOptionalString(input.actorId) ?? null,
        createdAt,
        details: input.details ?? {}
    };
    const absolutePath = laneSessionEventPathFor(cwd, input.laneId, event.eventId);
    atomicWriteJson(absolutePath, event);
    return {
        event,
        eventPath: relativePathFrom(cwd, absolutePath)
    };
}
export function listLaneSessionEvents(cwd, laneId) {
    const directory = laneSessionEventDirectory(path.resolve(cwd), laneId);
    if (!existsSync(directory))
        return [];
    return readdirSync(directory)
        .filter((entry) => entry.endsWith('.json'))
        .sort((left, right) => left.localeCompare(right))
        .map((entry) => readLaneSessionEventFile(path.join(directory, entry)))
        .filter((entry) => entry !== null)
        .sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId));
}
export function laneSessionEventDirectory(cwd, laneId) {
    return path.join(path.resolve(cwd), historyLaneSessionEventsRootRelativePath, safeFileId(laneId));
}
export function laneSessionEventPathFor(cwd, laneId, eventId) {
    return path.join(laneSessionEventDirectory(cwd, laneId), `${safeFileId(eventId)}.json`);
}
function createLaneSessionEventId(input) {
    const stamp = input.createdAt.replace(/:/g, '-').replace(/\./g, '-');
    const action = sanitizeAction(input.action);
    const digest = createHash('sha256')
        .update(`${input.laneId}\n${action}\n${input.actorId ?? ''}\n${input.createdAt}\n${input.sequence}`)
        .digest('hex')
        .slice(0, 12);
    return `${stamp}-${action}-${digest}`;
}
function readLaneSessionEventFile(filePath) {
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        if (parsed.schemaId !== 'atm.laneSessionEvent.v1' || !normalizeOptionalString(parsed.eventId) || !normalizeOptionalString(parsed.laneId)) {
            return null;
        }
        return {
            schemaId: 'atm.laneSessionEvent.v1',
            specVersion: '0.1.0',
            eventId: parsed.eventId.trim(),
            laneId: parsed.laneId.trim(),
            sequence: typeof parsed.sequence === 'number' && Number.isInteger(parsed.sequence) && parsed.sequence > 0 ? parsed.sequence : 1,
            action: sanitizeAction(parsed.action ?? 'event'),
            actorId: normalizeOptionalString(parsed.actorId) ?? null,
            createdAt: normalizeIsoString(parsed.createdAt) ?? new Date(0).toISOString(),
            details: normalizeDetails(parsed.details)
        };
    }
    catch {
        return null;
    }
}
function normalizeDetails(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function sanitizeAction(value) {
    const normalized = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized.length > 0 ? normalized : 'event';
}
function normalizeIsoString(value) {
    if (typeof value !== 'string' || !value.trim())
        return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function normalizeOptionalString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
function safeFileId(value) {
    return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}
