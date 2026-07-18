import path from 'node:path';
import { createSourceHashSnapshot } from '../../hash-lock/hash-lock.ts';
import { resolveAtomWorkbenchPath } from '../../manager/atom-space.ts';
import { createAtomicSpecSemanticFingerprint, normalizeSemanticFingerprint } from '../semantic-fingerprint.ts';
import { migrateRegistryStatus } from '../status-migration.ts';
import { normalizeProjectPath, normalizeSchemaPath, resolveProjectPath, normalizeStringArray } from './paths.ts';
import type { NormalizedModel, NormalizedVersionRecord, RegistryEntryOptions, VersionRecord } from './types.ts';

export const defaultRegistryOwner = Object.freeze({
  name: 'ATM maintainers',
  contact: 'maintainers@example.invalid'
});

export function createAtomicRegistryEntry(normalizedModel: NormalizedModel, options: RegistryEntryOptions = {}) {
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
  const semanticFingerprint = normalizeSemanticFingerprint(
    options.semanticFingerprint
      ?? normalizedModel.governance?.semanticFingerprint
      ?? createAtomicSpecSemanticFingerprint({
        inputs: normalizedModel.ports?.inputs ?? [],
        outputs: normalizedModel.ports?.outputs ?? [],
        language: { primary: normalizedModel.execution?.language?.primary ?? null },
        validation: { evidenceRequired: normalizedModel.execution?.validation?.evidenceRequired === true },
        performanceBudget: normalizedModel.execution?.performanceBudget ?? null
      })
  );
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

interface NormalizeVersionHistoryOptions {
  currentVersion?: string;
  selfVerification?: { specHash?: string; codeHash?: string; testHash?: string; digest?: string };
  semanticFingerprint?: unknown;
}

function normalizeVersionHistory(versions: VersionRecord[] | undefined, options: NormalizeVersionHistoryOptions = {}): NormalizedVersionRecord[] {
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

function normalizeVersionRecord(versionRecord: VersionRecord): NormalizedVersionRecord {
  const semanticFingerprint = normalizeSemanticFingerprint(versionRecord?.semanticFingerprint ?? null);
  const normalized: NormalizedVersionRecord = {
    version: String(versionRecord?.version ?? '0.1.0').trim(),
    specHash: String(versionRecord?.specHash ?? '').trim(),
    codeHash: String(versionRecord?.codeHash ?? '').trim(),
    testHash: String(versionRecord?.testHash ?? '').trim(),
    timestamp: String(versionRecord?.timestamp ?? new Date().toISOString()).trim()
  };

  if (semanticFingerprint) {
    normalized.semanticFingerprint = semanticFingerprint;
  } else if (versionRecord?.semanticFingerprint === null) {
    normalized.semanticFingerprint = null;
  }

  return normalized;
}

function collectEvidencePaths(repositoryRoot: string, normalizedModel: NormalizedModel, options: RegistryEntryOptions, reportPath: string | null): string[] {
  const fromOptions = normalizeStringArray((options.evidence ?? []).map((value: string) => normalizeProjectPath(repositoryRoot, value)));
  const fromArtifacts = normalizeStringArray((options.testReport?.artifacts ?? []).map((artifact: { artifactKind: string; artifactPath: string }) => normalizeProjectPath(repositoryRoot, artifact.artifactPath)));
  const fromEvidence = normalizeStringArray((options.testReport?.evidence ?? []).flatMap((entry: { artifactPaths?: string[] }) => entry.artifactPaths ?? []).map((value: string) => normalizeProjectPath(repositoryRoot, value)));
  const baseline = normalizeStringArray([
    normalizeProjectPath(repositoryRoot, normalizedModel.source.specPath),
    reportPath
  ]);
  return normalizeStringArray([...fromOptions, ...fromArtifacts, ...fromEvidence, ...baseline]);
}

function createCompatibilityRecord(normalizedModel: NormalizedModel): Record<string, string> {
  const compatibility: Record<string, string> = {
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

function deriveReportPath(repositoryRoot: string, reportPath: string | null, testReport: RegistryEntryOptions['testReport']): string | null {
  const explicitPath = reportPath ?? testReport?.artifacts?.find((artifact: { artifactKind: string; artifactPath: string }) => artifact.artifactKind === 'report')?.artifactPath ?? null;
  return explicitPath ? (normalizeProjectPath(repositoryRoot, explicitPath) ?? null) : null;
}

interface DeriveWorkbenchPathOptions {
  repositoryRoot: string;
  workbenchPath: string | null;
  reportPath: string | null;
}

function deriveWorkbenchPath(normalizedModel: NormalizedModel, options: DeriveWorkbenchPathOptions): string | null {
  const candidate = options.workbenchPath
    ? resolveProjectPath(options.repositoryRoot, options.workbenchPath)
    : options.reportPath
      ? path.dirname(resolveProjectPath(options.repositoryRoot, options.reportPath))
      : resolveAtomWorkbenchPath(normalizedModel, { repositoryRoot: options.repositoryRoot });
  return candidate ? (normalizeProjectPath(options.repositoryRoot, candidate) ?? null) : null;
}

function normalizeOwner(owner: { name?: string; contact?: string } | undefined): { name: string; contact: string } {
  return {
    name: owner?.name ?? defaultRegistryOwner.name,
    contact: owner?.contact ?? defaultRegistryOwner.contact
  };
}
