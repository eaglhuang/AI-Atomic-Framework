import path from 'node:path';
import { createSourceHashSnapshot } from '../../hash-lock/hash-lock.js';
import { resolveAtomWorkbenchPath } from '../../manager/atom-space.js';
import { createAtomicSpecSemanticFingerprint, normalizeSemanticFingerprint } from '../semantic-fingerprint.js';
import { migrateRegistryStatus } from '../status-migration.js';
import { normalizeProjectPath, normalizeSchemaPath, resolveProjectPath, normalizeStringArray } from './paths.js';
export const defaultRegistryOwner = Object.freeze({
    name: 'ATM maintainers',
    contact: 'maintainers@example.invalid'
});
export function createAtomicRegistryEntry(normalizedModel, options = {}) {
    const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
    const selfVerification = createSourceHashSnapshot({
        repositoryRoot,
        specPath: options.specPath ?? normalizedModel.source.specPath ?? undefined,
        codePaths: options.codePaths,
        testPaths: options.testPaths,
        legacyPlanningId: options.legacyPlanningId ?? null
    });
    const reportPath = deriveReportPath(repositoryRoot, options.reportPath ?? null, options.testReport);
    const workbenchPath = deriveWorkbenchPath(normalizedModel, {
        repositoryRoot,
        workbenchPath: options.workbenchPath ?? null,
        reportPath
    });
    const atomVersion = String(options.atomVersion ?? normalizedModel.schema.specVersion ?? '0.1.0').trim();
    const currentVersion = String(options.currentVersion ?? atomVersion).trim();
    const semanticFingerprint = normalizeSemanticFingerprint(options.semanticFingerprint
        ?? normalizedModel.governance?.semanticFingerprint
        ?? createAtomicSpecSemanticFingerprint({
            inputs: normalizedModel.ports?.inputs ?? [],
            outputs: normalizedModel.ports?.outputs ?? [],
            language: { primary: normalizedModel.execution?.language?.primary ?? null },
            validation: { evidenceRequired: normalizedModel.execution?.validation?.evidenceRequired === true },
            performanceBudget: normalizedModel.execution?.performanceBudget ?? null
        }));
    const versions = normalizeVersionHistory(options.versions, {
        currentVersion,
        selfVerification,
        semanticFingerprint
    });
    const statusMigration = migrateRegistryStatus({
        entryType: 'atom',
        status: options.status ?? 'active',
        governanceTier: options.governance?.tier ?? options.governanceTier ?? null
    });
    return {
        id: options.id ?? normalizedModel.identity.atomId,
        atomId: normalizedModel.identity.atomId,
        logicalName: options.logicalName ?? normalizedModel.identity.logicalName ?? undefined,
        atomVersion,
        currentVersion,
        versions,
        schemaId: normalizedModel.schema.schemaId,
        specVersion: normalizedModel.schema.specVersion,
        schemaPath: normalizeSchemaPath(repositoryRoot, options.schemaPath ?? normalizedModel.source.schemaPath),
        specPath: selfVerification.sourcePaths.spec,
        hashLock: { ...normalizedModel.hashLock },
        owner: normalizeOwner(options.owner),
        status: statusMigration.status,
        governance: statusMigration.governance,
        semanticFingerprint,
        location: {
            specPath: selfVerification.sourcePaths.spec,
            codePaths: [...selfVerification.sourcePaths.code],
            testPaths: [...selfVerification.sourcePaths.tests],
            reportPath,
            workbenchPath
        },
        lineageLogRef: options.lineageLogRef ?? undefined,
        evidenceIndexRef: options.evidenceIndexRef ?? undefined,
        ttl: typeof options.ttl === 'number' ? options.ttl : undefined,
        compatibility: createCompatibilityRecord(normalizedModel),
        evidence: collectEvidencePaths(repositoryRoot, normalizedModel, options, reportPath),
        selfVerification
    };
}
function normalizeVersionHistory(versions, options = {}) {
    if (Array.isArray(versions) && versions.length > 0) {
        return versions.map((version) => normalizeVersionRecord(version));
    }
    return [
        normalizeVersionRecord({
            version: options.currentVersion ?? '0.1.0',
            specHash: options.selfVerification?.specHash ?? options.selfVerification?.digest ?? '',
            codeHash: options.selfVerification?.codeHash ?? options.selfVerification?.digest ?? '',
            testHash: options.selfVerification?.testHash ?? options.selfVerification?.digest ?? '',
            timestamp: new Date().toISOString(),
            semanticFingerprint: options.semanticFingerprint ?? null
        })
    ];
}
function normalizeVersionRecord(versionRecord) {
    const semanticFingerprint = normalizeSemanticFingerprint(versionRecord?.semanticFingerprint ?? null);
    const normalized = {
        version: String(versionRecord?.version ?? '0.1.0').trim(),
        specHash: String(versionRecord?.specHash ?? '').trim(),
        codeHash: String(versionRecord?.codeHash ?? '').trim(),
        testHash: String(versionRecord?.testHash ?? '').trim(),
        timestamp: String(versionRecord?.timestamp ?? new Date().toISOString()).trim()
    };
    if (semanticFingerprint) {
        normalized.semanticFingerprint = semanticFingerprint;
    }
    else if (versionRecord?.semanticFingerprint === null) {
        normalized.semanticFingerprint = null;
    }
    return normalized;
}
function collectEvidencePaths(repositoryRoot, normalizedModel, options, reportPath) {
    const fromOptions = normalizeStringArray((options.evidence ?? []).map((value) => normalizeProjectPath(repositoryRoot, value)));
    const fromArtifacts = normalizeStringArray((options.testReport?.artifacts ?? []).map((artifact) => normalizeProjectPath(repositoryRoot, artifact.artifactPath)));
    const fromEvidence = normalizeStringArray((options.testReport?.evidence ?? []).flatMap((entry) => entry.artifactPaths ?? []).map((value) => normalizeProjectPath(repositoryRoot, value)));
    const baseline = normalizeStringArray([
        normalizeProjectPath(repositoryRoot, normalizedModel.source.specPath),
        reportPath
    ]);
    return normalizeStringArray([...fromOptions, ...fromArtifacts, ...fromEvidence, ...baseline]);
}
function createCompatibilityRecord(normalizedModel) {
    const compatibility = {
        coreVersion: normalizedModel.execution.compatibility.coreVersion,
        registryVersion: normalizedModel.execution.compatibility.registryVersion
    };
    if (normalizedModel.execution.compatibility.pluginApiVersion) {
        compatibility.pluginApiVersion = normalizedModel.execution.compatibility.pluginApiVersion;
    }
    if (normalizedModel.execution.compatibility.languageAdapter) {
        compatibility.languageAdapter = normalizedModel.execution.compatibility.languageAdapter;
    }
    return compatibility;
}
function deriveReportPath(repositoryRoot, reportPath, testReport) {
    const explicitPath = reportPath ?? testReport?.artifacts?.find((artifact) => artifact.artifactKind === 'report')?.artifactPath ?? null;
    return explicitPath ? (normalizeProjectPath(repositoryRoot, explicitPath) ?? null) : null;
}
function deriveWorkbenchPath(normalizedModel, options) {
    const candidate = options.workbenchPath
        ? resolveProjectPath(options.repositoryRoot, options.workbenchPath)
        : options.reportPath
            ? path.dirname(resolveProjectPath(options.repositoryRoot, options.reportPath))
            : resolveAtomWorkbenchPath(normalizedModel, { repositoryRoot: options.repositoryRoot });
    return candidate ? (normalizeProjectPath(options.repositoryRoot, candidate) ?? null) : null;
}
function normalizeOwner(owner) {
    return {
        name: owner?.name ?? defaultRegistryOwner.name,
        contact: owner?.contact ?? defaultRegistryOwner.contact
    };
}
