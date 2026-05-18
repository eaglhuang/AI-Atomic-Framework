import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validatePropagationReport } from '../test-runner/propagation.ts';
import { resolveCanonicalMapPaths } from '../test-runner/map-integration.ts';
import { createAtomicMapRegistryEntry, isAtomicMapRegistryEntry } from './map-registry.ts';
import { validateRetirementProof } from './retirement-proof.ts';
import { validateRollbackProof } from './rollback-proof.ts';
import { validateRegistryDocumentFile, writeRegistryArtifacts } from './registry.ts';

export const ReplacementMode = Object.freeze({
  Draft: 'draft',
  Shadow: 'shadow',
  Canary: 'canary',
  Active: 'active',
  LegacyRetired: 'legacy-retired'
});

type ReplacementModeValue = typeof ReplacementMode[keyof typeof ReplacementMode];
type ReplacementModeWithEvidence = Exclude<ReplacementModeValue, 'draft'>;

interface ReplacementTransitionInput {
  readonly from: ReplacementModeValue;
  readonly to: ReplacementModeValue;
  readonly evidenceRefs: readonly string[];
  readonly canonicalMapId: string;
  readonly repositoryRoot: string;
}

const orderedReplacementModes: readonly ReplacementModeValue[] = [
  ReplacementMode.Draft,
  ReplacementMode.Shadow,
  ReplacementMode.Canary,
  ReplacementMode.Active,
  ReplacementMode.LegacyRetired
];

const evidenceRequirementByTarget: Readonly<Record<ReplacementModeWithEvidence, string>> = Object.freeze({
  [ReplacementMode.Shadow]: 'map integration evidence',
  [ReplacementMode.Canary]: 'map equivalence evidence',
  [ReplacementMode.Active]: 'map equivalence / propagation / review advisory / human review evidence',
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
    canonicalMapId: target.mapId,
    repositoryRoot
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

function validateTransition(input: ReplacementTransitionInput) {
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

  if (input.evidenceRefs.length === 0 && requiresEvidence(input.to)) {
    const requiredEvidence = evidenceRequirementByTarget[input.to];
    throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', `Transition to ${input.to} requires ${requiredEvidence}.`, {
      from: input.from,
      to: input.to,
      requiredEvidence,
      mapId: input.canonicalMapId
    });
  }

  if (input.to === ReplacementMode.Active) {
    validateActiveTransitionEvidence({ ...input, to: ReplacementMode.Active });
  }
  if (input.to === ReplacementMode.LegacyRetired) {
    validateLegacyRetiredEvidence({ ...input, to: ReplacementMode.LegacyRetired });
  }
}

function validateActiveTransitionEvidence(input: ReplacementTransitionInput & { readonly to: typeof ReplacementMode.Active }) {
  const evidenceDocuments = loadEvidenceDocuments(input.repositoryRoot, input.evidenceRefs);
  const gateResults = {
    mapEquivalence: findMapEquivalenceEvidence(input.canonicalMapId, evidenceDocuments),
    propagationReport: findPropagationEvidence(input.canonicalMapId, evidenceDocuments),
    reviewAdvisory: findReviewAdvisoryEvidence(input.canonicalMapId, evidenceDocuments),
    humanReview: findHumanReviewEvidence(input.canonicalMapId, evidenceDocuments)
  };
  const blockedGateNames = Object.entries(gateResults)
    .filter(([, gate]) => gate.passed !== true)
    .map(([gateName]) => gateName);
  if (blockedGateNames.length === 0) {
    return;
  }

  const requiredEvidenceKinds = blockedGateNames.map(mapGateNameToEvidenceKind);
  throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', `Transition to ${input.to} requires ${evidenceRequirementByTarget[input.to]}.`, {
    from: input.from,
    to: input.to,
    requiredEvidence: evidenceRequirementByTarget[input.to],
    mapId: input.canonicalMapId,
    blockedGateNames,
    missingEvidenceKinds: requiredEvidenceKinds,
    invalidEvidenceRefs: evidenceDocuments.filter((entry) => entry.error).map((entry) => ({
      path: entry.path,
      error: entry.error
    })),
    requiredJustification: {
      requestedReplacementMode: ReplacementMode.Active,
      requiredGateNames: blockedGateNames,
      requiredEvidenceKinds,
      humanReviewRequired: true,
      rationale: 'Canary promotion to active requires passing map equivalence, propagation, review advisory, and approved human review evidence.'
    },
    nextActionHint: buildReplacementLaneNextActionHint(input, requiredEvidenceKinds)
  });
}

function validateLegacyRetiredEvidence(input: ReplacementTransitionInput & { readonly to: typeof ReplacementMode.LegacyRetired }) {
  const evidenceDocuments = loadEvidenceDocuments(input.repositoryRoot, input.evidenceRefs);
  const rollbackProof = findRollbackProofEvidence(input.canonicalMapId, evidenceDocuments);
  const retirementProof = findRetirementProofEvidence(input.canonicalMapId, evidenceDocuments);
  if (rollbackProof.passed === true || retirementProof.passed === true) {
    return;
  }

  const blockedGateNames = ['rollbackProof', 'retirementProof'];
  const requiredEvidenceKinds = blockedGateNames.map(mapGateNameToEvidenceKind);
  throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', `Transition to ${input.to} requires ${evidenceRequirementByTarget[input.to]}.`, {
    from: input.from,
    to: input.to,
    requiredEvidence: evidenceRequirementByTarget[input.to],
    mapId: input.canonicalMapId,
    blockedGateNames,
    missingEvidenceKinds: requiredEvidenceKinds,
    invalidEvidenceRefs: evidenceDocuments.filter((entry) => entry.error).map((entry) => ({
      path: entry.path,
      error: entry.error
    })),
    requiredJustification: {
      requestedReplacementMode: ReplacementMode.LegacyRetired,
      requiredGateNames: blockedGateNames,
      requiredEvidenceKinds,
      humanReviewRequired: true,
      rationale: 'Active promotion to legacy-retired requires a passing rollback proof or retirement proof, and retirement proof must clear caller and entrypoint risk.'
    },
    nextActionHint: buildReplacementLaneNextActionHint(input, requiredEvidenceKinds)
  });
}

function loadEvidenceDocuments(repositoryRoot: string, evidenceRefs: readonly string[]) {
  return evidenceRefs.map((evidenceRef) => {
    const absolutePath = path.isAbsolute(evidenceRef) ? evidenceRef : path.join(repositoryRoot, evidenceRef);
    if (!existsSync(absolutePath)) {
      return {
        path: evidenceRef,
        absolutePath,
        document: null,
        error: 'evidence file was not found'
      };
    }
    try {
      return {
        path: evidenceRef,
        absolutePath,
        document: readJson(absolutePath),
        error: null
      };
    } catch (error) {
      return {
        path: evidenceRef,
        absolutePath,
        document: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
}

function findMapEquivalenceEvidence(mapId: string, evidenceDocuments: any[]) {
  const match = evidenceDocuments.find((entry) => entry.document?.schemaId === 'atm.mapEquivalenceReport'
    && entry.document?.mapId === mapId
    && entry.document?.passed === true);
  return {
    passed: Boolean(match),
    path: match?.path ?? null
  };
}

function findPropagationEvidence(mapId: string, evidenceDocuments: any[]) {
  const match = evidenceDocuments.find((entry) => safeValidatePropagationEvidence(entry.document, mapId).ok === true);
  return {
    passed: Boolean(match),
    path: match?.path ?? null
  };
}

function findReviewAdvisoryEvidence(mapId: string, evidenceDocuments: any[]) {
  const match = evidenceDocuments.find((entry) => {
    const document = entry.document;
    if (!document || typeof document !== 'object') {
      return false;
    }
    const advisoryTarget = document.target ?? null;
    const targetMatches = advisoryTarget == null
      || advisoryTarget.kind === 'proposal'
      || advisoryTarget.id == null
      || advisoryTarget.id === mapId;
    return targetMatches
      && document.advisoryUnavailable !== true
      && (document.status === 'ok' || document.status === 'warn')
      && typeof document.reportId === 'string';
  });
  return {
    passed: Boolean(match),
    path: match?.path ?? null
  };
}

function findHumanReviewEvidence(mapId: string, evidenceDocuments: any[]) {
  const match = evidenceDocuments.find((entry) => {
    const document = entry.document;
    if (!document || typeof document !== 'object') {
      return false;
    }
    const reviewedMapId = document.queueRecord?.proposal?.target?.mapId ?? document.proposal?.target?.mapId ?? null;
    return document.schemaId === 'atm.humanReviewDecision'
      && document.decision === 'approve'
      && document.queueRecord?.status === 'approved'
      && (reviewedMapId == null || reviewedMapId === mapId);
  });
  return {
    passed: Boolean(match),
    path: match?.path ?? null
  };
}

function findRollbackProofEvidence(mapId: string, evidenceDocuments: any[]) {
  const match = evidenceDocuments.find((entry) => safeValidateRollbackEvidence(entry.document, mapId).ok === true);
  return {
    passed: Boolean(match),
    path: match?.path ?? null
  };
}

function findRetirementProofEvidence(mapId: string, evidenceDocuments: any[]) {
  const match = evidenceDocuments.find((entry) => safeValidateRetirementEvidence(entry.document, mapId).ok === true);
  return {
    passed: Boolean(match),
    path: match?.path ?? null
  };
}

function safeValidatePropagationEvidence(document: any, mapId: string) {
  try {
    return validatePropagationReport(document, { mapId });
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function safeValidateRollbackEvidence(document: any, mapId: string) {
  try {
    if (document?.schemaId !== 'atm.rollbackProof' || document?.targetKind !== 'map' || document?.mapId !== mapId || document?.verificationStatus !== 'passed') {
      return { ok: false, issues: ['rollback proof does not match target map or did not pass'] };
    }
    return validateRollbackProof(document);
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function safeValidateRetirementEvidence(document: any, mapId: string) {
  try {
    if (document?.schemaId !== 'atm.retirementProof' || document?.mapId !== mapId || document?.verificationStatus !== 'passed') {
      return { ok: false, issues: ['retirement proof does not match target map or did not pass'] };
    }
    return validateRetirementProof(document);
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function mapGateNameToEvidenceKind(gateName: string) {
  switch (gateName) {
    case 'mapEquivalence':
      return 'map-equivalence';
    case 'propagationReport':
      return 'propagation-report';
    case 'reviewAdvisory':
      return 'review-advisory';
    case 'humanReview':
      return 'human-review';
    case 'rollbackProof':
      return 'rollback-proof';
    case 'retirementProof':
      return 'retirement-proof';
    default:
      return gateName;
  }
}

function buildReplacementLaneNextActionHint(input: ReplacementTransitionInput, requiredEvidenceKinds: readonly string[]) {
  const evidenceArgs = requiredEvidenceKinds
    .map((kind) => `--evidence <${kind}.json>`)
    .join(' ');
  return {
    status: 'blocked',
    route: 'replacement-evidence-required',
    reason: `Replacement lane transition to ${input.to} requires additional machine-readable evidence.`,
    command: `node atm.mjs replacement-lane transition --cwd <repository-root> --map ${input.canonicalMapId} --to ${input.to} ${evidenceArgs} --json`,
    commandTemplate: true,
    requiredEvidenceKinds
  };
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

function normalizeReplacementMode(value: string): ReplacementModeValue {
  const mode = String(value || '').trim();
  if (!isReplacementModeValue(mode)) {
    throw createReplacementLaneError('ATM_REPLACEMENT_TRANSITION_INVALID', `Unsupported replacement mode: ${mode}`, {
      mode
    });
  }
  return mode;
}

function isReplacementModeValue(value: string): value is ReplacementModeValue {
  return (orderedReplacementModes as readonly string[]).includes(value);
}

function requiresEvidence(mode: ReplacementModeValue): mode is ReplacementModeWithEvidence {
  return mode !== ReplacementMode.Draft;
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
