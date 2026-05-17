import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCanonicalMapPaths } from '../test-runner/map-integration.ts';
import { createAtomicMapRegistryEntry, isAtomicMapRegistryEntry } from './map-registry.ts';
import { validateRegistryDocumentFile, writeRegistryArtifacts } from './registry.ts';

export const ReplacementMode = Object.freeze({
  Draft: 'draft',
  Shadow: 'shadow',
  Canary: 'canary',
  Active: 'active',
  LegacyRetired: 'legacy-retired'
});

const orderedReplacementModes = [
  ReplacementMode.Draft,
  ReplacementMode.Shadow,
  ReplacementMode.Canary,
  ReplacementMode.Active,
  ReplacementMode.LegacyRetired
];

const evidenceRequirementByTarget = Object.freeze({
  [ReplacementMode.Shadow]: 'map integration evidence',
  [ReplacementMode.Canary]: 'map equivalence evidence',
  [ReplacementMode.Active]: 'map equivalence / propagation / review evidence',
  [ReplacementMode.LegacyRetired]: 'rollback proof or retirement proof'
});

export function transitionReplacementMode(mapId: string, to: string, evidence: any = {}, options: any = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const now = normalizeTimestamp(options.now ?? new Date().toISOString());
  const actor = normalizeActor(options.actor ?? process.env.AGENT_IDENTITY ?? 'ATM replacement lane');
  const targetMode = normalizeReplacementMode(to);
  const target = loadReplacementLaneTarget(repositoryRoot, mapId);
  const fromMode = normalizeReplacementMode(target.mapSpec.replacement?.mode ?? ReplacementMode.Draft);
  const evidenceRefs = normalizeEvidenceRefs(evidence.evidenceRefs);

  validateTransition({
    from: fromMode,
    to: targetMode,
    evidenceRefs,
    canonicalMapId: target.mapId
  });

  const reason = normalizeReason(evidence.reason, defaultTransitionReason(fromMode, targetMode));
  const lineageLogPath = target.paths.lineageLogPath;
  const mergedEvidenceRefs = mergeStringArrays(target.mapSpec.replacement?.evidenceRefs ?? [], evidenceRefs);
  const updatedMapSpec = {
    ...target.mapSpec,
    replacement: {
      ...target.mapSpec.replacement,
      legacyUris: [...target.mapSpec.replacement.legacyUris],
      mode: targetMode,
      evidenceRefs: mergedEvidenceRefs
    },
    lineageLogRef: lineageLogPath
  };

  const transitionRecord = {
    from: fromMode,
    to: targetMode,
    reason,
    evidenceRefs: [...evidenceRefs],
    actor,
    timestamp: now
  };
  const updatedLineageLog = appendTransitionRecord(target.lineageLog, {
    mapId: target.mapId,
    generatedAt: now,
    transitionRecord
  });
  const updatedRegistryEntry = createAtomicMapRegistryEntry(updatedMapSpec, {
    schemaPath: target.registryEntry.schemaPath,
    semanticFingerprint: target.registryEntry.semanticFingerprint,
    lineageLogRef: lineageLogPath,
    ttl: target.registryEntry.ttl,
    pendingSfCalculation: target.registryEntry.pendingSfCalculation === true,
    status: target.registryEntry.status,
    governanceTier: target.registryEntry.governance?.tier,
    location: target.registryEntry.location,
    evidence: mergeStringArrays(target.registryEntry.evidence ?? [], [lineageLogPath])
  });
  const updatedRegistry = {
    ...target.registryDocument,
    generatedAt: now,
    entries: target.registryDocument.entries.map((entry: any) => isAtomicMapRegistryEntry(entry) && entry.mapId === target.mapId
      ? updatedRegistryEntry
      : entry)
  };

  writeJson(path.join(repositoryRoot, target.paths.specPath), updatedMapSpec);
  mkdirSync(path.dirname(path.join(repositoryRoot, lineageLogPath)), { recursive: true });
  writeJson(path.join(repositoryRoot, lineageLogPath), updatedLineageLog);
  writeRegistryArtifacts(updatedRegistry, {
    repositoryRoot,
    registryPath: 'atomic-registry.json',
    sourceOfTruthLabel: 'atomic-registry.json'
  });

  const validation = validateRegistryDocumentFile(path.join(repositoryRoot, 'atomic-registry.json'));
  if (!validation.ok) {
    throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', validation.promptReport?.summary ?? 'Updated registry is invalid.', {
      mapId: target.mapId,
      issues: validation.promptReport?.issues ?? []
    });
  }

  return {
    ok: true,
    mapId: target.mapId,
    from: fromMode,
    to: targetMode,
    registryStatus: target.registryEntry.status,
    reason,
    evidenceRefs: [...evidenceRefs],
    actor,
    timestamp: now,
    specPath: target.paths.specPath,
    registryPath: 'atomic-registry.json',
    lineageLogPath,
    transitionRecord,
    mapSpec: updatedMapSpec,
    registryEntry: updatedRegistryEntry,
    lineageLog: updatedLineageLog
  };
}

function loadReplacementLaneTarget(repositoryRoot: string, mapId: string) {
  const canonicalMapId = String(mapId || '').trim();
  const paths = resolveCanonicalMapPaths(canonicalMapId);
  const specAbsolutePath = path.join(repositoryRoot, paths.specPath);
  const registryAbsolutePath = path.join(repositoryRoot, 'atomic-registry.json');
  if (!existsSync(specAbsolutePath)) {
    throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', 'Replacement lane target map spec was not found.', {
      mapId: canonicalMapId,
      specPath: paths.specPath
    });
  }
  if (!existsSync(registryAbsolutePath)) {
    throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', 'Replacement lane requires atomic-registry.json.', {
      mapId: canonicalMapId,
      registryPath: 'atomic-registry.json'
    });
  }

  const mapSpec = readJson(specAbsolutePath);
  if (mapSpec?.mapId !== canonicalMapId) {
    throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', 'Replacement lane mapId mismatch in map spec.', {
      expectedMapId: canonicalMapId,
      actualMapId: mapSpec?.mapId ?? null
    });
  }
  if (!mapSpec?.replacement || !Array.isArray(mapSpec.replacement.legacyUris) || mapSpec.replacement.legacyUris.length === 0) {
    throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', 'Replacement lane requires replacement.legacyUris on the map spec.', {
      mapId: canonicalMapId,
      specPath: paths.specPath
    });
  }

  const registryDocument = readJson(registryAbsolutePath);
  const registryEntry = Array.isArray(registryDocument?.entries)
    ? registryDocument.entries.find((entry: any) => isAtomicMapRegistryEntry(entry) && entry.mapId === canonicalMapId)
    : null;
  if (!registryEntry) {
    throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', 'Replacement lane requires a matching map entry in atomic-registry.json.', {
      mapId: canonicalMapId,
      registryPath: 'atomic-registry.json'
    });
  }

  const lineageLogPath = mapSpec.lineageLogRef ?? `${paths.workbenchPath}/lineage-log.json`;
  const lineageLogAbsolutePath = path.join(repositoryRoot, lineageLogPath);
  const lineageLog = existsSync(lineageLogAbsolutePath)
    ? readJson(lineageLogAbsolutePath)
    : null;

  return {
    mapId: canonicalMapId,
    paths: {
      ...paths,
      lineageLogPath
    },
    mapSpec,
    registryDocument,
    registryEntry,
    lineageLog
  };
}

function validateTransition(input: any) {
  const currentIndex = orderedReplacementModes.indexOf(input.from);
  const nextIndex = orderedReplacementModes.indexOf(input.to);
  const isForwardSingleStep = currentIndex >= 0 && nextIndex === currentIndex + 1;
  if (!isForwardSingleStep) {
    throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', `Illegal replacement lane transition: ${input.from} -> ${input.to}.`, {
      from: input.from,
      to: input.to,
      allowedNextMode: orderedReplacementModes[currentIndex + 1] ?? null,
      mapId: input.canonicalMapId
    });
  }

  if (input.evidenceRefs.length === 0) {
    throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', `Transition to ${input.to} requires ${evidenceRequirementByTarget[input.to]}.`, {
      from: input.from,
      to: input.to,
      requiredEvidence: evidenceRequirementByTarget[input.to],
      mapId: input.canonicalMapId
    });
  }
}

function appendTransitionRecord(existingLog: any, input: any) {
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

function normalizeReplacementMode(value: string) {
  const mode = String(value || '').trim();
  if (!orderedReplacementModes.includes(mode)) {
    throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', `Unsupported replacement mode: ${mode}`, {
      mode
    });
  }
  return mode;
}

function normalizeEvidenceRefs(value: any) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))];
}

function mergeStringArrays(...groups: any[]) {
  return [...new Set(groups.flatMap((group) => Array.isArray(group) ? group : []).map((entry) => String(entry || '').trim()).filter(Boolean))];
}

function normalizeReason(value: any, fallback: string) {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeActor(value: any) {
  const actor = String(value || '').trim();
  return actor || 'ATM replacement lane';
}

function normalizeTimestamp(value: any) {
  const timestamp = String(value || '').trim();
  if (!timestamp) {
    throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', 'Transition timestamp is required.', {});
  }
  return timestamp;
}

function defaultTransitionReason(from: string, to: string) {
  return `Replacement lane transition ${from} -> ${to}.`;
}

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, value: any) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createReplacementLaneError(code: string, message: string, details: Record<string, unknown>) {
  const error = new Error(message) as Error & { code: string; details: Record<string, unknown> };
  error.name = 'ReplacementLaneTransitionError';
  error.code = code;
  error.details = details;
  return error;
}