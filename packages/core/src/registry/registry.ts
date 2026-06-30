import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isRegistryEntryStatus, isRegistryGovernanceTier, registryGovernanceTiers } from './status-machine.ts';
import { createSourceHashSnapshot, normalizeSourcePathList } from '../hash-lock/hash-lock.ts';
import { createAtomicSpecSemanticFingerprint, normalizeSemanticFingerprint, type SemanticFingerprintPortRecord } from './semantic-fingerprint.ts';
import { migrateRegistryStatus } from './status-migration.ts';
import { resolveAtomWorkbenchPath } from '../manager/atom-space.ts';
import { writeRegistryCatalogFile } from './registry-catalog.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const require = createRequire(import.meta.url);

export const defaultRegistrySchemaPath = path.join(repoRoot, 'schemas', 'registry.schema.json');
export const defaultRegistryOwner = Object.freeze({
  name: 'ATM maintainers',
  contact: 'maintainers@example.invalid'
});

/** Shape expected for a normalized atom spec model passed into registry functions */
interface NormalizedModel {
  identity: { atomId: string; logicalName?: string };
  schema: { schemaId: string; specVersion: string };
  source: { specPath: string | null; schemaPath?: string };
  hashLock: Record<string, unknown>;
  governance?: { semanticFingerprint?: unknown };
  ports?: { inputs?: SemanticFingerprintPortRecord[]; outputs?: SemanticFingerprintPortRecord[] };
  execution: {
    language?: { primary?: string | null };
    validation?: { evidenceRequired?: boolean };
    performanceBudget?: Readonly<Record<string, unknown>> | null;
    compatibility: {
      coreVersion: string;
      registryVersion: string;
      pluginApiVersion?: string;
      languageAdapter?: string;
    };
  };
}

/** Options accepted by createAtomicRegistryEntry */
interface RegistryEntryOptions {
  repositoryRoot?: string;
  specPath?: string;
  codePaths?: string | string[];
  testPaths?: string | string[];
  legacyPlanningId?: string | null;
  reportPath?: string | null;
  workbenchPath?: string | null;
  atomVersion?: string | number;
  currentVersion?: string;
  semanticFingerprint?: unknown;
  versions?: VersionRecord[];
  status?: string;
  governance?: { tier?: string };
  governanceTier?: string;
  id?: string;
  logicalName?: string;
  schemaPath?: string;
  owner?: { name?: string; contact?: string };
  lineageLogRef?: string;
  evidenceIndexRef?: string;
  ttl?: number;
  evidence?: string[];
  testReport?: {
    artifacts?: Array<{ artifactKind: string; artifactPath: string }>;
    evidence?: Array<{ artifactPaths?: string[] }>;
  };
}

interface VersionRecord {
  version?: string;
  specHash?: string;
  codeHash?: string;
  testHash?: string;
  timestamp?: string;
  semanticFingerprint?: unknown;
}

interface NormalizedVersionRecord {
  version: string;
  specHash: string;
  codeHash: string;
  testHash: string;
  timestamp: string;
  semanticFingerprint?: unknown;
}

/** Options for createRegistryDocument */
interface RegistryDocumentOptions {
  registryId?: string;
  generatedAt?: string;
  migration?: { strategy?: string; fromVersion?: string | null; notes?: string };
  sharding?: { strategy?: string; partPaths?: string[]; nextRegistryId?: string | null };
}

/** Options for writeRegistryArtifacts */
interface WriteRegistryArtifactsOptions {
  repositoryRoot?: string;
  registryPath?: string;
  writeCatalog?: boolean;
  specRepositoryRoot?: string;
  catalogPath?: string;
  catalogTitle?: string;
  sourceOfTruthLabel?: string;
}

/** Options for validateRegistryDocument */
interface ValidateRegistryDocumentOptions {
  schemaPath?: string;
  validatorMode?: string;
  validatorReason?: string;
}

/** Options for evaluateRegistryEntryDrift */
interface EvaluateRegistryEntryDriftOptions {
  repositoryRoot?: string;
}

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

export function createRegistryDocument(entries: unknown[], options: RegistryDocumentOptions = {}) {
  const document: Record<string, unknown> = {
    schemaId: 'atm.registry',
    specVersion: '0.1.0',
    migration: normalizeMigration(options.migration),
    registryId: options.registryId ?? 'registry.atoms',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    entries: [...entries]
  };

  if (options.sharding) {
    document.sharding = normalizeSharding(options.sharding);
  }

  return document;
}

export function writeRegistryArtifacts(registryDocument: Record<string, unknown>, options: WriteRegistryArtifactsOptions = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const registryPath = resolveProjectPath(repositoryRoot, options.registryPath ?? 'atomic-registry.json');
  mkdirSync(path.dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, `${JSON.stringify(registryDocument, null, 2)}\n`, 'utf8');

  const result: { registryPath: string; catalogPath: string | null } = {
    registryPath: toProjectPath(repositoryRoot, registryPath),
    catalogPath: null
  };

  if (options.writeCatalog !== false) {
    const catalogResult = writeRegistryCatalogFile(registryDocument, {
      repositoryRoot,
      specRepositoryRoot: options.specRepositoryRoot ?? repositoryRoot,
      catalogPath: options.catalogPath,
      title: options.catalogTitle,
      sourceOfTruthLabel: options.sourceOfTruthLabel
    });
    result.catalogPath = catalogResult.catalogPath ?? null;
  }

  return result;
}

export function validateRegistryDocument(registryDocument: unknown, options: ValidateRegistryDocumentOptions = {}) {
  const schemaPath = path.resolve(options.schemaPath ?? defaultRegistrySchemaPath);
  const validatorMode = normalizeValidatorMode(options.validatorMode);
  if (!existsSync(schemaPath)) {
    return createFailure(schemaPath, 'ATM_REGISTRY_SCHEMA_NOT_FOUND', [
      {
        code: 'ATM_REGISTRY_SCHEMA_NOT_FOUND',
        keyword: 'exists',
        path: toPortablePath(schemaPath),
        text: 'Registry schema file was not found.',
        prompt: `Restore the registry schema file at ${toPortablePath(schemaPath)}.`
      }
    ]);
  }

  if (validatorMode !== 'structural-only') {
    let ajv;
    try {
      let Ajv2020, addFormats;
      try {
        Ajv2020 = require('ajv/dist/2020.js');
        addFormats = require('ajv-formats');
      } catch {
        const cwdRequire = createRequire(path.join(process.cwd(), 'package.json'));
        Ajv2020 = cwdRequire('ajv/dist/2020.js');
        addFormats = cwdRequire('ajv-formats');
      }
      const AjvConstructor = Ajv2020.default ?? Ajv2020;
      const addFormatsPlugin = addFormats.default ?? addFormats;
      ajv = new AjvConstructor({ allErrors: true, strict: false });
      addFormatsPlugin(ajv);
    } catch (error) {
      if (validatorMode === 'schema') {
        return createFailure(schemaPath, 'ATM_REGISTRY_VALIDATOR_UNAVAILABLE', [
          {
            code: 'ATM_REGISTRY_VALIDATOR_UNAVAILABLE',
            keyword: 'runtime',
            path: toPortablePath(schemaPath),
            text: 'AJV validator is not available in this environment.',
            prompt: `Install the validator dependency or restore the AJV runtime. Reason: ${error instanceof Error ? error.message : String(error)}`
          }
        ]);
      }
      return validateRegistryDocumentStructurally(registryDocument, {
        schemaPath,
        validatorReason: error instanceof Error ? error.message : String(error)
      });
    }

    const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
    const valid = validate(registryDocument);
    if (!valid) {
      return createFailure(schemaPath, 'ATM_REGISTRY_INVALID', (validate.errors || []).map((err: { keyword: string; instancePath: string; message?: string }) => ({
        code: 'ATM_REGISTRY_INVALID',
        keyword: err.keyword,
        path: err.instancePath && err.instancePath.length > 0 ? err.instancePath : '/',
        text: err.message ?? 'Invalid registry document.',
        prompt: `Fix the registry document field at ${err.instancePath && err.instancePath.length > 0 ? err.instancePath : '/'} (${err.keyword}).`
      })));
    }

    return {
      ok: true,
      schemaPath: toPortablePath(schemaPath),
      validationMode: 'schema',
      promptReport: {
        code: 'ATM_REGISTRY_OK',
        summary: `Registry document ${(registryDocument as Record<string, unknown>).registryId} validated successfully.`,
        issues: []
      }
    };
  }

  return validateRegistryDocumentStructurally(registryDocument, { schemaPath });
}

export function validateRegistryDocumentFile(registryPath: string, options: ValidateRegistryDocumentOptions = {}) {
  const resolvedPath = path.resolve(registryPath);
  if (!existsSync(resolvedPath)) {
    return {
      ok: false,
      registryPath: toPortablePath(resolvedPath),
      schemaPath: toPortablePath(path.resolve(options.schemaPath ?? defaultRegistrySchemaPath)),
      document: null,
      promptReport: {
        code: 'ATM_REGISTRY_NOT_FOUND',
        summary: 'Atomic registry file was not found.',
        issues: [
          {
            code: 'ATM_REGISTRY_NOT_FOUND',
            keyword: 'exists',
            path: toPortablePath(resolvedPath),
            text: 'Atomic registry file was not found.',
            prompt: `Restore the registry file at ${toPortablePath(resolvedPath)}.`
          }
        ]
      }
    };
  }

  let document;
  try {
    document = JSON.parse(readFileSync(resolvedPath, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      registryPath: toPortablePath(resolvedPath),
      schemaPath: toPortablePath(path.resolve(options.schemaPath ?? defaultRegistrySchemaPath)),
      document: null,
      promptReport: {
        code: 'ATM_JSON_INVALID',
        summary: 'Atomic registry JSON is invalid.',
        issues: [
          {
            code: 'ATM_JSON_INVALID',
            keyword: 'json',
            path: toPortablePath(resolvedPath),
            text: 'Atomic registry JSON is invalid.',
            prompt: `Fix the JSON syntax in ${toPortablePath(resolvedPath)}. Reason: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      }
    };
  }

  const validation = validateRegistryDocument(document, options);
  return {
    ...validation,
    registryPath: toPortablePath(resolvedPath),
    document
  };
}

interface RegistryEntry {
  selfVerification?: {
    sourcePaths?: { spec?: string; code?: string | string[]; tests?: string[] };
    specHash?: string;
    codeHash?: string;
    testHash?: string;
    legacyPlanningId?: string | null;
  };
}

export function evaluateRegistryEntryDrift(entry: RegistryEntry, options: EvaluateRegistryEntryDriftOptions = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const sourcePaths = entry?.selfVerification?.sourcePaths;
  if (!sourcePaths?.spec) {
    return {
      ok: false,
      issues: ['sourcePaths'],
      report: null,
      entry,
      error: 'Registry entry is missing selfVerification.sourcePaths.spec.'
    };
  }

  try {
    const current = createSourceHashSnapshot({
      repositoryRoot,
      specPath: sourcePaths.spec,
      codePaths: normalizeSourcePathList(sourcePaths.code),
      testPaths: sourcePaths.tests,
      legacyPlanningId: entry.selfVerification!.legacyPlanningId ?? null
    });
    const report = {
      legacyPlanningId: {
        expected: entry.selfVerification!.legacyPlanningId ?? null,
        actual: current.legacyPlanningId,
        ok: (entry.selfVerification!.legacyPlanningId ?? null) === current.legacyPlanningId
      },
      specHash: {
        expected: entry.selfVerification!.specHash,
        actual: current.specHash,
        ok: entry.selfVerification!.specHash === current.specHash
      },
      codeHash: {
        expected: entry.selfVerification!.codeHash,
        actual: current.codeHash,
        ok: entry.selfVerification!.codeHash === current.codeHash
      },
      testHash: {
        expected: entry.selfVerification!.testHash,
        actual: current.testHash,
        ok: entry.selfVerification!.testHash === current.testHash
      }
    };

    return {
      ok: Object.values(report).every((value) => value.ok === true),
      issues: Object.entries(report).filter(([, value]) => value.ok !== true).map(([key]) => key),
      report,
      entry
    };
  } catch (error) {
    return {
      ok: false,
      issues: ['sourcePaths'],
      report: null,
      entry,
      error: error instanceof Error ? error.message : String(error)
    };
  }
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

function normalizeMigration(migration: RegistryDocumentOptions['migration']): { strategy: string; fromVersion: string | null; notes: string } {
  return {
    strategy: migration?.strategy ?? 'none',
    fromVersion: migration?.fromVersion ?? null,
    notes: migration?.notes ?? 'Initial alpha0 registry document.'
  };
}

function normalizeOwner(owner: { name?: string; contact?: string } | undefined): { name: string; contact: string } {
  return {
    name: owner?.name ?? defaultRegistryOwner.name,
    contact: owner?.contact ?? defaultRegistryOwner.contact
  };
}

function normalizeSharding(sharding: { strategy?: string; partPaths?: string[]; nextRegistryId?: string | null }): { strategy: string; partPaths: string[]; nextRegistryId: string | null } {
  return {
    strategy: sharding.strategy ?? 'single-document',
    partPaths: [...(sharding.partPaths ?? [])],
    nextRegistryId: sharding.nextRegistryId ?? null
  };
}

function normalizeProjectPath(repositoryRoot: string, value: string | null | undefined): string | null | undefined {
  if (!value) {
    return value;
  }
  return toProjectPath(repositoryRoot, resolveProjectPath(repositoryRoot, value));
}

function normalizeSchemaPath(repositoryRoot: string, value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }

  const resolvedPath = resolveProjectPath(repositoryRoot, value);
  const repositoryRelative = toProjectPath(repositoryRoot, resolvedPath);
  if (repositoryRelative.startsWith('schemas/')) {
    return repositoryRelative;
  }

  const frameworkRelative = path.relative(repoRoot, resolvedPath).replace(/\\/g, '/');
  if (frameworkRelative && !frameworkRelative.startsWith('..') && frameworkRelative.startsWith('schemas/')) {
    return frameworkRelative;
  }

  return toPortablePath(resolvedPath);
}

function resolveProjectPath(repositoryRoot: string, value: string): string {
  return path.isAbsolute(value)
    ? path.normalize(value)
    : path.resolve(repositoryRoot, value);
}

function toProjectPath(repositoryRoot: string, filePath: string): string {
  const relative = path.relative(repositoryRoot, filePath).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..')) {
    return toPortablePath(filePath);
  }
  return relative;
}

function normalizeStringArray(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter(Boolean))) as string[];
}

function normalizeValidatorMode(value: string | undefined): 'auto' | 'schema' | 'structural-only' {
  const mode = String(value ?? 'auto').trim();
  if (mode === 'auto' || mode === 'schema' || mode === 'structural-only') {
    return mode as 'auto' | 'schema' | 'structural-only';
  }
  throw new Error(`Unsupported registry validator mode: ${mode || '<empty>'}`);
}

type IssueReporter = (pathValue: string, keyword: string, text: string) => void;

interface ValidationIssue {
  code: string;
  keyword: string;
  path: string;
  text: string;
  prompt: string;
}

function validateRegistryDocumentStructurally(registryDocument: unknown, options: ValidateRegistryDocumentOptions = {}) {
  const schemaPath = toPortablePath(options.schemaPath ?? defaultRegistrySchemaPath);
  const issues: ValidationIssue[] = [];
  const doc = registryDocument as Record<string, unknown> | null | undefined;
  const registryId = typeof doc?.registryId === 'string' ? doc.registryId : '<unknown>';
  const issue: IssueReporter = (pathValue: string, keyword: string, text: string) => {
    issues.push({
      code: 'ATM_REGISTRY_INVALID',
      keyword,
      path: pathValue,
      text,
      prompt: `Fix the registry document field at ${pathValue} (${keyword}).`
    });
  };

  if (!isPlainObject(registryDocument)) {
    issue('/', 'type', 'Registry document must be an object.');
    return createFailure(schemaPath, 'ATM_REGISTRY_INVALID', issues);
  }

  if (doc!.schemaId !== 'atm.registry') {
    issue('/schemaId', 'const', 'Registry document schemaId must equal atm.registry.');
  }
  if (!isNonEmptyString(doc!.specVersion)) {
    issue('/specVersion', 'type', 'Registry document specVersion must be a non-empty string.');
  }
  if (!isNonEmptyString(doc!.registryId)) {
    issue('/registryId', 'type', 'Registry document registryId must be a non-empty string.');
  }
  if (!isNonEmptyString(doc!.generatedAt)) {
    issue('/generatedAt', 'type', 'Registry document generatedAt must be a non-empty string.');
  }
  if (!Array.isArray(doc!.entries)) {
    issue('/entries', 'type', 'Registry document entries must be an array.');
  } else {
    (doc!.entries as unknown[]).forEach((entry: unknown, index: number) => validateRegistryEntryStructurally(entry, `/entries/${index}`, issue));
  }

  if (isPlainObject(doc!.sharding)) {
    const sharding = doc!.sharding as Record<string, unknown>;
    if (!['single-document', 'external-parts'].includes(String(sharding.strategy ?? '').trim())) {
      issue('/sharding/strategy', 'enum', 'Registry sharding strategy must be single-document or external-parts.');
    }
    if (!Array.isArray(sharding.partPaths)) {
      issue('/sharding/partPaths', 'type', 'Registry sharding partPaths must be an array.');
    }
  }

  if (issues.length > 0) {
    return createFailure(schemaPath, 'ATM_REGISTRY_INVALID', issues);
  }

  const summarySuffix = options.validatorReason
    ? ` using structural fallback (${options.validatorReason}).`
    : ' using structural fallback.';
  return {
    ok: true,
    schemaPath,
    validationMode: 'structural',
    promptReport: {
      code: 'ATM_REGISTRY_OK',
      summary: `Registry document ${registryId} validated successfully${summarySuffix}`,
      issues: []
    }
  };
}

function validateRegistryEntryStructurally(entry: unknown, basePath: string, issue: IssueReporter): void {
  if (!isPlainObject(entry)) {
    issue(basePath, 'type', 'Registry entry must be an object.');
    return;
  }

  const e = entry as Record<string, unknown>;
  if (e.schemaId === 'atm.atomicMap') {
    validateAtomicMapRegistryEntryStructurally(e, basePath, issue);
    return;
  }
  if (e.schemaId === 'atm.atomicSpec') {
    validateAtomicSpecRegistryEntryStructurally(e, basePath, issue);
    return;
  }
  issue(`${basePath}/schemaId`, 'enum', 'Registry entry schemaId must be atm.atomicSpec or atm.atomicMap.');
}

function validateAtomicMapRegistryEntryStructurally(entry: Record<string, unknown>, basePath: string, issue: IssueReporter): void {
  requireString(entry.mapId, `${basePath}/mapId`, issue);
  requireString(entry.mapVersion, `${basePath}/mapVersion`, issue);
  requireString(entry.specVersion, `${basePath}/specVersion`, issue);
  requireString(entry.schemaPath, `${basePath}/schemaPath`, issue);
  requireString(entry.mapHash, `${basePath}/mapHash`, issue);
  requireRegistryStatus(entry.status, `${basePath}/status`, issue);
  requireGovernance(entry.governance, `${basePath}/governance`, issue);
  requireStringArray(entry.entrypoints, `${basePath}/entrypoints`, issue);
  requireMembers(entry.members, `${basePath}/members`, issue);
  requireEdges(entry.edges, `${basePath}/edges`, issue);
  requireQualityTargets(entry.qualityTargets, `${basePath}/qualityTargets`, issue);
  requireOptionalLocation(entry.location, `${basePath}/location`, issue);
  requireOptionalEvidence(entry.evidence, `${basePath}/evidence`, issue);

  if (entry.replacement !== undefined) {
    if (!isPlainObject(entry.replacement)) {
      issue(`${basePath}/replacement`, 'type', 'Atomic map replacement must be an object.');
    } else {
      const replacement = entry.replacement as Record<string, unknown>;
      requireStringArray(replacement.legacyUris, `${basePath}/replacement/legacyUris`, issue);
      requireStringArray(replacement.evidenceRefs, `${basePath}/replacement/evidenceRefs`, issue);
      const mode = String(replacement.mode ?? '').trim();
      if (!['draft', 'shadow', 'canary', 'active', 'legacy-retired'].includes(mode)) {
        issue(`${basePath}/replacement/mode`, 'enum', 'Atomic map replacement mode must be draft, shadow, canary, active, or legacy-retired.');
      }
    }
  }
}

function validateAtomicSpecRegistryEntryStructurally(entry: Record<string, unknown>, basePath: string, issue: IssueReporter): void {
  requireString(entry.atomId, `${basePath}/atomId`, issue);
  requireString(entry.specVersion, `${basePath}/specVersion`, issue);
  requireString(entry.schemaPath, `${basePath}/schemaPath`, issue);
  requireString(entry.specPath, `${basePath}/specPath`, issue);
  requireRegistryStatus(entry.status, `${basePath}/status`, issue);
  requireGovernance(entry.governance, `${basePath}/governance`, issue);
  requireOptionalLocation(entry.location, `${basePath}/location`, issue);
  requireOptionalEvidence(entry.evidence, `${basePath}/evidence`, issue);

  if (!isPlainObject(entry.hashLock) || !isNonEmptyString((entry.hashLock as Record<string, unknown>).digest)) {
    issue(`${basePath}/hashLock`, 'type', 'Atomic spec registry entry hashLock must include a digest.');
  }
  if (!isPlainObject(entry.owner) || !isNonEmptyString((entry.owner as Record<string, unknown>).name) || !isNonEmptyString((entry.owner as Record<string, unknown>).contact)) {
    issue(`${basePath}/owner`, 'type', 'Atomic spec registry entry owner must include name and contact.');
  }
  if (!isPlainObject(entry.compatibility) || !isNonEmptyString((entry.compatibility as Record<string, unknown>).coreVersion) || !isNonEmptyString((entry.compatibility as Record<string, unknown>).registryVersion)) {
    issue(`${basePath}/compatibility`, 'type', 'Atomic spec registry entry compatibility must include coreVersion and registryVersion.');
  }
  if (!isPlainObject(entry.selfVerification)) {
    issue(`${basePath}/selfVerification`, 'type', 'Atomic spec registry entry selfVerification must be an object.');
    return;
  }
  const sv = entry.selfVerification as Record<string, unknown>;
  requireString(sv.specHash, `${basePath}/selfVerification/specHash`, issue);
  requireString(sv.codeHash, `${basePath}/selfVerification/codeHash`, issue);
  requireString(sv.testHash, `${basePath}/selfVerification/testHash`, issue);
  if (!isPlainObject(sv.sourcePaths)) {
    issue(`${basePath}/selfVerification/sourcePaths`, 'type', 'Atomic spec registry entry selfVerification.sourcePaths must be an object.');
  } else {
    const sourcePaths = sv.sourcePaths as Record<string, unknown>;
    requireString(sourcePaths.spec, `${basePath}/selfVerification/sourcePaths/spec`, issue);
    const code = sourcePaths.code;
    if (!(isNonEmptyString(code) || Array.isArray(code))) {
      issue(`${basePath}/selfVerification/sourcePaths/code`, 'type', 'Atomic spec registry entry selfVerification.sourcePaths.code must be a string or array.');
    }
    requireStringArray(sourcePaths.tests, `${basePath}/selfVerification/sourcePaths/tests`, issue);
  }
}

function requireString(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (!isNonEmptyString(value)) {
    issue(pathValue, 'type', 'Field must be a non-empty string.');
  }
}

function requireStringArray(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (!Array.isArray(value)) {
    issue(pathValue, 'type', 'Field must be an array of non-empty strings.');
    return;
  }
  value.forEach((entry: unknown, index: number) => {
    if (!isNonEmptyString(entry)) {
      issue(`${pathValue}/${index}`, 'type', 'Array item must be a non-empty string.');
    }
  });
}

function requireMembers(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (!Array.isArray(value)) {
    issue(pathValue, 'type', 'Atomic map members must be an array.');
    return;
  }
  value.forEach((member: unknown, index: number) => {
    if (!isPlainObject(member)) {
      issue(`${pathValue}/${index}`, 'type', 'Atomic map member must be an object.');
      return;
    }
    const m = member as Record<string, unknown>;
    requireString(m.atomId, `${pathValue}/${index}/atomId`, issue);
    requireString(m.version, `${pathValue}/${index}/version`, issue);
  });
}

function requireEdges(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (!Array.isArray(value)) {
    issue(pathValue, 'type', 'Atomic map edges must be an array.');
    return;
  }
  value.forEach((edge: unknown, index: number) => {
    if (!isPlainObject(edge)) {
      issue(`${pathValue}/${index}`, 'type', 'Atomic map edge must be an object.');
      return;
    }
    const e = edge as Record<string, unknown>;
    requireString(e.from, `${pathValue}/${index}/from`, issue);
    requireString(e.to, `${pathValue}/${index}/to`, issue);
    requireString(e.binding, `${pathValue}/${index}/binding`, issue);
  });
}

function requireQualityTargets(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (!isPlainObject(value)) {
    issue(pathValue, 'type', 'Atomic map qualityTargets must be an object.');
    return;
  }
  for (const [key, targetValue] of Object.entries(value as Record<string, unknown>)) {
    if (!['string', 'number', 'boolean'].includes(typeof targetValue)) {
      issue(`${pathValue}/${key}`, 'type', 'Atomic map quality target values must be string, number, or boolean.');
    }
  }
}

function requireRegistryStatus(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (!isRegistryEntryStatus(value)) {
    issue(pathValue, 'enum', 'Registry status must be one of the supported registry entry statuses.');
  }
}

function requireGovernance(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (!isPlainObject(value)) {
    issue(pathValue, 'type', 'Governance must be an object.');
    return;
  }
  const gov = value as Record<string, unknown>;
  if (!isRegistryGovernanceTier(gov.tier)) {
    issue(`${pathValue}/tier`, 'enum', `Governance tier must be one of ${registryGovernanceTiers.join(', ')}.`);
  }
}

function requireOptionalLocation(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (value === undefined) {
    return;
  }
  if (!isPlainObject(value)) {
    issue(pathValue, 'type', 'Location must be an object.');
    return;
  }
  const loc = value as Record<string, unknown>;
  requireString(loc.specPath, `${pathValue}/specPath`, issue);
  if (!Array.isArray(loc.codePaths)) {
    issue(`${pathValue}/codePaths`, 'type', 'Location codePaths must be an array.');
  }
  if (!Array.isArray(loc.testPaths)) {
    issue(`${pathValue}/testPaths`, 'type', 'Location testPaths must be an array.');
  }
}

function requireOptionalEvidence(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (value === undefined) {
    return;
  }
  requireStringArray(value, pathValue, issue);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function createFailure(schemaPath: string, code: string, issues: ValidationIssue[]) {
  return {
    ok: false,
    schemaPath: toPortablePath(schemaPath),
    promptReport: {
      code,
      summary: `Registry validation failed with ${issues.length} issue(s).`,
      issues
    }
  };
}

function toPortablePath(value: string): string {
  return value.replace(/\\/g, '/');
}
