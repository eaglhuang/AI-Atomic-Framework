import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ReplacementMode, orderedReplacementModes } from './constants.ts';
import type { EvidenceDocumentRecord, ReplacementModeValue, TransitionAppendInput } from './types.ts';

export function normalizeReplacementMode(value: string): ReplacementModeValue {
  const mode = String(value || '').trim();
  if (!isReplacementModeValue(mode)) {
    throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', `Unsupported replacement mode: ${mode}`, {
      mode
    });
  }
  return mode;
}

export function isReplacementModeValue(value: string): value is ReplacementModeValue {
  return (orderedReplacementModes as readonly string[]).includes(value);
}

export function requiresEvidence(mode: ReplacementModeValue) {
  return mode !== ReplacementMode.Draft;
}

export function normalizeEvidenceRefs(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))];
}

export function mergeStringArrays(...groups: unknown[]) {
  return [...new Set(groups.flatMap((group) => Array.isArray(group) ? group : []).map((entry) => String(entry || '').trim()).filter(Boolean))];
}

export function normalizeReason(value: unknown, fallback: string) {
  const text = String(value || '').trim();
  return text || fallback;
}

export function normalizeActor(value: unknown) {
  const actor = String(value || '').trim();
  return actor || 'ATM replacement lane';
}

export function normalizeTimestamp(value: unknown) {
  const timestamp = String(value || '').trim();
  if (!timestamp) {
    throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', 'Transition timestamp is required.', {});
  }
  return timestamp;
}

export function defaultTransitionReason(from: string, to: string) {
  return `Replacement lane transition ${from} -> ${to}.`;
}

export function resolveRegistryLifecycleStatus(targetMode: ReplacementModeValue, currentStatus: string) {
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

export function appendTransitionRecord(existingLog: unknown, input: TransitionAppendInput) {
  const currentLog = existingLog && typeof existingLog === 'object' && !Array.isArray(existingLog)
    ? existingLog as EvidenceDocumentRecord & Record<string, unknown>
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

export function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function createReplacementLaneError(code: string, message: string, details: Record<string, unknown>) {
  const error = new Error(message) as Error & { code: string; details: Record<string, unknown> };
  error.name = 'ReplacementLaneTransitionError';
  error.code = code;
  error.details = details;
  return error;
}
