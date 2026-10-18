import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createAtomicMapRegistryEntry, isAtomicMapRegistryEntry } from '../map-registry.js';
import { validateRegistryDocumentFile, writeRegistryArtifacts } from '../registry.js';
import { ReplacementMode } from './constants.js';
import { appendTransitionRecord, createReplacementLaneError, defaultTransitionReason, mergeStringArrays, normalizeActor, normalizeEvidenceRefs, normalizeReason, normalizeReplacementMode, normalizeTimestamp, resolveRegistryLifecycleStatus, writeJson } from './support.js';
import { loadReplacementLaneTarget } from './target.js';
import { validateTransition } from './validation.js';
export function transitionReplacementMode(mapId, to, evidence = {}, options = {}) {
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
    const updatedRegistryStatus = resolveRegistryLifecycleStatus(targetMode, target.registryEntry.status);
    const updatedRegistryEntry = createAtomicMapRegistryEntry(updatedMapSpec, {
        schemaPath: target.registryEntry.schemaPath,
        semanticFingerprint: target.registryEntry.semanticFingerprint,
        lineageLogRef: lineageLogPath,
        ttl: target.registryEntry.ttl,
        pendingSfCalculation: target.registryEntry.pendingSfCalculation === true,
        status: updatedRegistryStatus,
        governanceTier: target.registryEntry.governance?.tier,
        location: target.registryEntry.location,
        evidence: mergeStringArrays(target.registryEntry.evidence ?? [], [lineageLogPath])
    });
    const updatedRegistry = {
        ...target.registryDocument,
        generatedAt: now,
        entries: target.registryDocument.entries.map((entry) => isAtomicMapRegistryEntry(entry) && entry.mapId === target.mapId
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
        registryStatus: updatedRegistryEntry.status,
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
