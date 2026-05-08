import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createSourceHashSnapshot, normalizeSourcePathList } from '../hash-lock/hash-lock.mjs';
import { createAtomicSpecSemanticFingerprint, normalizeSemanticFingerprint } from './semantic-fingerprint.ts';
import { resolveAtomWorkbenchPath } from '../manager/atom-space.mjs';
import { writeRegistryCatalogFile } from './registry-catalog.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const require = createRequire(import.meta.url);

export const defaultRegistrySchemaPath = path.join(repoRoot, 'schemas', 'registry.schema.json');
export const defaultRegistryOwner = Object.freeze({
  name: 'ATM maintainers',
  contact: 'maintainers@example.invalid'
});

export function createAtomicRegistryEntry(normalizedModel, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const selfVerification = createSourceHashSnapshot({
    repositoryRoot,
    specPath: options.specPath ?? normalizedModel.source.specPath,
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
    status: options.status ?? 'active',
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

export function createRegistryDocument(entries, options = {}) {
  const document = {
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

export function writeRegistryArtifacts(registryDocument, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const registryPath = resolveProjectPath(repositoryRoot, options.registryPath ?? 'atomic-registry.json');
  mkdirSync(path.dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, `${JSON.stringify(registryDocument, null, 2)}\n`, 'utf8');

  const result = {
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
    result.catalogPath = catalogResult.catalogPath;
  }

  return result;
}

export function validateRegistryDocument(registryDocument, options = {}) {
  const schemaPath = path.resolve(options.schemaPath ?? defaultRegistrySchemaPath);
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

  let ajv;
  try {
    const Ajv2020 = require('ajv/dist/2020.js');
    const addFormats = require('ajv-formats');
    const AjvConstructor = Ajv2020.default ?? Ajv2020;
    const addFormatsPlugin = addFormats.default ?? addFormats;
    ajv = new AjvConstructor({ allErrors: true, strict: false });
    addFormatsPlugin(ajv);
  } catch (error) {
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

  const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
  const valid = validate(registryDocument);
  if (!valid) {
    return createFailure(schemaPath, 'ATM_REGISTRY_INVALID', (validate.errors || []).map((error) => ({
      code: 'ATM_REGISTRY_INVALID',
      keyword: error.keyword,
      path: error.instancePath && error.instancePath.length > 0 ? error.instancePath : '/',
      text: error.message ?? 'Invalid registry document.',
      prompt: `Fix the registry document field at ${error.instancePath && error.instancePath.length > 0 ? error.instancePath : '/'} (${error.keyword}).`
    })));
  }

  return {
    ok: true,
    schemaPath: toPortablePath(schemaPath),
    promptReport: {
      code: 'ATM_REGISTRY_OK',
      summary: `Registry document ${registryDocument.registryId} validated successfully.`,
      issues: []
    }
  };
}

export function validateRegistryDocumentFile(registryPath, options = {}) {
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

export function evaluateRegistryEntryDrift(entry, options = {}) {
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
      legacyPlanningId: entry.selfVerification.legacyPlanningId ?? null
    });
    const report = {
      legacyPlanningId: {
        expected: entry.selfVerification.legacyPlanningId ?? null,
        actual: current.legacyPlanningId,
        ok: (entry.selfVerification.legacyPlanningId ?? null) === current.legacyPlanningId
      },
      specHash: {
        expected: entry.selfVerification.specHash,
        actual: current.specHash,
        ok: entry.selfVerification.specHash === current.specHash
      },
      codeHash: {
        expected: entry.selfVerification.codeHash,
        actual: current.codeHash,
        ok: entry.selfVerification.codeHash === current.codeHash
      },
      testHash: {
        expected: entry.selfVerification.testHash,
        actual: current.testHash,
        ok: entry.selfVerification.testHash === current.testHash
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
  } else if (versionRecord?.semanticFingerprint === null) {
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
  return explicitPath ? normalizeProjectPath(repositoryRoot, explicitPath) : null;
}

function deriveWorkbenchPath(normalizedModel, options) {
  const candidate = options.workbenchPath
    ? resolveProjectPath(options.repositoryRoot, options.workbenchPath)
    : options.reportPath
      ? path.dirname(resolveProjectPath(options.repositoryRoot, options.reportPath))
      : resolveAtomWorkbenchPath(normalizedModel, { repositoryRoot: options.repositoryRoot });
  return candidate ? normalizeProjectPath(options.repositoryRoot, candidate) : null;
}

function normalizeMigration(migration) {
  return {
    strategy: migration?.strategy ?? 'none',
    fromVersion: migration?.fromVersion ?? null,
    notes: migration?.notes ?? 'Initial alpha0 registry document.'
  };
}

function normalizeOwner(owner) {
  return {
    name: owner?.name ?? defaultRegistryOwner.name,
    contact: owner?.contact ?? defaultRegistryOwner.contact
  };
}

function normalizeSharding(sharding) {
  return {
    strategy: sharding.strategy ?? 'single-document',
    partPaths: [...(sharding.partPaths ?? [])],
    nextRegistryId: sharding.nextRegistryId ?? null
  };
}

function normalizeProjectPath(repositoryRoot, value) {
  if (!value) {
    return value;
  }
  return toProjectPath(repositoryRoot, resolveProjectPath(repositoryRoot, value));
}

function normalizeSchemaPath(repositoryRoot, value) {
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

function resolveProjectPath(repositoryRoot, value) {
  return path.isAbsolute(value)
    ? path.normalize(value)
    : path.resolve(repositoryRoot, value);
}

function toProjectPath(repositoryRoot, filePath) {
  const relative = path.relative(repositoryRoot, filePath).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..')) {
    return toPortablePath(filePath);
  }
  return relative;
}

function normalizeStringArray(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function createFailure(schemaPath, code, issues) {
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

function toPortablePath(value) {
  return value.replace(/\\/g, '/');
}
