import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ReplacementMode, orderedReplacementModes } from './constants.js';
export function normalizeReplacementMode(value) {
    const mode = String(value || '').trim();
    if (!isReplacementModeValue(mode)) {
        throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', `Unsupported replacement mode: ${mode}`, {
            mode
        });
    }
    return mode;
}
export function isReplacementModeValue(value) {
    return orderedReplacementModes.includes(value);
}
export function requiresEvidence(mode) {
    return mode !== ReplacementMode.Draft;
}
export function normalizeEvidenceRefs(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))];
}
export function mergeStringArrays(...groups) {
    return [...new Set(groups.flatMap((group) => Array.isArray(group) ? group : []).map((entry) => String(entry || '').trim()).filter(Boolean))];
}
export function normalizeReason(value, fallback) {
    const text = String(value || '').trim();
    return text || fallback;
}
export function normalizeActor(value) {
    const actor = String(value || '').trim();
    return actor || 'ATM replacement lane';
}
export function normalizeTimestamp(value) {
    const timestamp = String(value || '').trim();
    if (!timestamp) {
        throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', 'Transition timestamp is required.', {});
    }
    return timestamp;
}
export function defaultTransitionReason(from, to) {
    return `Replacement lane transition ${from} -> ${to}.`;
}
export function resolveRegistryLifecycleStatus(targetMode, currentStatus) {
    switch (targetMode) {
        case ReplacementMode.Draft:
            return 'draft';
        case ReplacementMode.Shadow:
        case ReplacementMode.Canary:
            return currentStatus === 'active' ? 'active' : 'validated';
        case ReplacementMode.Active:
        case ReplacementMode.LegacyRetired:
            return 'active';
        default:
            return currentStatus;
    }
}
export function appendTransitionRecord(existingLog, input) {
    const currentLog = existingLog && typeof existingLog === 'object' && !Array.isArray(existingLog)
        ? existingLog
        : {};
    const transitions = Array.isArray(currentLog.transitions) ? [...currentLog.transitions] : [];
    transitions.push(input.transitionRecord);
    return {
        schemaId: currentLog.schemaId ?? 'atm.mapLineageLog',
        specVersion: currentLog.specVersion ?? '0.1.0',
        ...currentLog,
        canonicalMapId: currentLog.canonicalMapId ?? input.mapId,
        generatedAt: input.generatedAt,
        transitions
    };
}
export function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}
export function writeJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
export function createReplacementLaneError(code, message, details) {
    const error = new Error(message);
    error.name = 'ReplacementLaneTransitionError';
    error.code = code;
    error.details = details;
    return error;
}
