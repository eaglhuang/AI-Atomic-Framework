import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseAtomicSpecDocument } from '../spec/parse-spec.mjs';
import { createAtomicSpecSemanticFingerprint } from '../registry/semantic-fingerprint.ts';
import { scaffoldAtomWorkbench } from './scaffold.mjs';
import { runAtomicTestRunner } from './test-runner.mjs';
import { allocateAtomId, AtomIdAllocationError, normalizeAtomBucket, parseAtomId } from './id-allocator.mjs';
import { createAtomicRegistryEntry, createRegistryDocument, validateRegistryDocumentFile, writeRegistryArtifacts } from '../registry/registry.mjs';

const defaultRegistryPath = 'atomic-registry.json';
const defaultCatalogPath = 'atomic_workbench/registry-catalog.md';
const defaultOwner = Object.freeze({
  name: 'ATM maintainers',
  contact: 'maintainers@example.invalid'
});

export function generateAtom(request, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const registryPath = options.registryPath ?? defaultRegistryPath;
  const registryAbsolutePath = path.resolve(repositoryRoot, registryPath);
  const dryRun = options.dryRun === true;
  const phases = [];

  try {
    const normalizedRequest = normalizeRequest(request);
    const registryDocument = readRegistryDocument(registryAbsolutePath, options);
    const existingEntry = findExistingEntry(registryDocument, normalizedRequest);
    if (existingEntry && options.force !== true) {
      return createSuccess({
        atomId: existingEntry.atomId,
        workbenchPath: existingEntry.location?.workbenchPath ?? null,
        specPath: existingEntry.location?.specPath ?? existingEntry.specPath ?? null,
        testPath: existingEntry.location?.testPaths?.[0] ?? null,
        registryEntry: existingEntry,
        registryPath,
        catalogPath: defaultCatalogPath,
        allocation: null,
        scaffold: null,
        testRun: null,
        idempotent: true,
        dryRun,
        phases: [recordPhase(phases, 'idempotent-existing-entry', () => ({ existingAtomId: existingEntry.atomId }))]
      });
    }

    const allocation = recordPhase(phases, 'allocate-id', () => allocateGeneratorAtomId(normalizedRequest, {
      repositoryRoot,
      registryPath,
      registryDocument,
      existingEntry,
      atomId: options.atomId,
      force: options.force === true
    }));
    const paths = createAtomPaths(allocation.atomId);
    const specDocument = createMinimalAtomSpec({
      ...normalizedRequest,
      atomId: allocation.atomId,
      sourcePath: paths.sourcePath,
      validationCommands: options.validationCommands
    });
    const specAbsolutePath = path.join(repositoryRoot, paths.specPath);
    const sourceAbsolutePath = path.join(repositoryRoot, paths.sourcePath);
    const testAbsolutePath = path.join(repositoryRoot, paths.testPath);
    const parsed = recordPhase(phases, 'init-spec', () => {
      const parseResult = parseAtomicSpecDocument(specDocument, { specPath: specAbsolutePath });
      if (!parseResult.ok) {
        throw createGeneratorError('ATM_GENERATOR_SPEC_INVALID', parseResult.promptReport?.summary ?? 'Generated atomic spec is invalid.', { parseResult });
      }
      return parseResult;
    });
    const specExistsBefore = existsSync(specAbsolutePath);
    const sourceExistsBefore = existsSync(sourceAbsolutePath);
    const testExistsBefore = existsSync(testAbsolutePath);
    const scaffold = recordPhase(phases, 'scaffold', () => scaffoldAtomWorkbench(parsed.normalizedModel, {
      repositoryRoot,
      dryRun,
      overwriteExisting: options.overwriteExisting === true
    }));

    if (!dryRun) {
      mkdirSync(path.dirname(specAbsolutePath), { recursive: true });
      if (!specExistsBefore || options.overwriteExisting === true) {
        writeFileSync(specAbsolutePath, `${JSON.stringify(specDocument, null, 2)}\n`, 'utf8');
      }
      if (!sourceExistsBefore || options.overwriteExisting === true) {
        writeFileSync(sourceAbsolutePath, normalizeTrailingNewline(options.sourceContent ?? renderDefaultAtomSource(specDocument)), 'utf8');
      }
      if (options.testContent && (!testExistsBefore || options.overwriteExisting === true)) {
        writeFileSync(testAbsolutePath, normalizeTrailingNewline(options.testContent), 'utf8');
      }
    }

    if (dryRun) {
      return createSuccess({
        atomId: allocation.atomId,
        workbenchPath: paths.workbenchPath,
        specPath: paths.specPath,
        sourcePath: paths.sourcePath,
        testPath: paths.testPath,
        registryEntry: null,
        registryPath,
        catalogPath: defaultCatalogPath,
        allocation,
        scaffold,
        testRun: null,
        idempotent: false,
        dryRun,
        phases
      });
    }

    const testRun = recordPhase(phases, 'test', () => runAtomicTestRunner(parsed.normalizedModel, {
      repositoryRoot,
      now: options.now
    }));
    if (!testRun.ok) {
      throw createGeneratorError('ATM_GENERATOR_TEST_FAILED', 'Generated atom validation command failed.', { testRun });
    }

    const registryEntry = recordPhase(phases, 'register-entry', () => createAtomicRegistryEntry(parsed.normalizedModel, {
      repositoryRoot,
      atomVersion: options.atomVersion ?? '0.1.0',
      status: options.status ?? 'active',
      owner: options.owner ?? defaultOwner,
      codePaths: options.codePaths ?? [paths.sourcePath],
      testPaths: options.testPaths ?? [paths.testPath],
      testReport: testRun.report,
      logicalName: normalizedRequest.logicalName,
      semanticFingerprint: parsed.normalizedModel.governance?.semanticFingerprint ?? null,
      evidence: ['generator-provenance:generated', paths.sourcePath, ...(options.evidence ?? [])],
      legacyPlanningId: options.legacyPlanningId ?? null
    }));
    const updatedRegistryDocument = upsertRegistryEntry(registryDocument, registryEntry, {
      generatedAt: options.now ?? new Date().toISOString()
    });
    const writeResult = recordPhase(phases, 'write-registry', () => writeRegistryArtifacts(updatedRegistryDocument, {
      repositoryRoot,
      registryPath,
      catalogPath: options.catalogPath ?? defaultCatalogPath,
      sourceOfTruthLabel: registryPath
    }));
    const validation = recordPhase(phases, 'validate-registry', () => validateRegistryDocumentFile(registryAbsolutePath));
    if (!validation.ok) {
      throw createGeneratorError('ATM_GENERATOR_REGISTRY_INVALID', validation.promptReport?.summary ?? 'Updated registry is invalid.', { validation });
    }

    return createSuccess({
      atomId: allocation.atomId,
      workbenchPath: paths.workbenchPath,
      specPath: paths.specPath,
      sourcePath: paths.sourcePath,
      testPath: paths.testPath,
      registryEntry,
      registryPath: writeResult.registryPath,
      catalogPath: writeResult.catalogPath,
      allocation,
      scaffold,
      testRun,
      idempotent: false,
      dryRun,
      phases
    });
  } catch (error) {
    return createFailure(error, phases);
  }
}

export function createMinimalAtomSpec(request) {
  const bucket = normalizeAtomBucket(request.bucket);
  const logicalName = normalizeLogicalName(request.logicalName ?? `atom.${bucket.toLowerCase()}-${slugify(request.title)}`);
  const sourcePath = request.sourcePath ? toPortablePath(request.sourcePath) : null;
  const validationCommands = Array.isArray(request.validationCommands) && request.validationCommands.length > 0
    ? [...request.validationCommands]
    : [sourcePath ? `node ${JSON.stringify(sourcePath)} --self-check` : `node -e "console.log('${request.atomId} validation ok')"`];

  return {
    schemaId: 'atm.atomicSpec',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Generated by AtomGenerator provisioning facade.'
    },
    id: request.atomId,
    logicalName,
    title: request.title,
    description: request.description,
    language: {
      primary: 'javascript',
      sourceExtensions: ['.mjs', '.ts'],
      tooling: ['node']
    },
    runtime: {
      kind: 'node',
      versionRange: '>=20',
      environment: 'local'
    },
    adapterRequirements: {
      projectAdapter: 'local-fs',
      storage: 'local-fs',
      capabilities: ['filesystem', 'schema-validator', 'test-runner', 'evidence-store']
    },
    compatibility: {
      coreVersion: '0.1.0',
      registryVersion: '0.1.0',
      languageAdapter: 'language-js',
      lifecycleMode: 'birth'
    },
    hashLock: {
      algorithm: 'sha256',
      digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      canonicalization: 'json-stable-v1'
    },
    dependencyPolicy: {
      external: 'workspace-only',
      hostCoupling: 'forbidden'
    },
    inputs: [
      { name: 'request', kind: 'json', required: true }
    ],
    outputs: [
      { name: 'result', kind: 'json', required: true }
    ],
    validation: {
      commands: validationCommands,
      evidenceRequired: true
    },
    performanceBudget: {
      hotPath: false,
      inputMutation: 'forbidden',
      maxDurationMs: 10000
    },
    semanticFingerprint: createAtomicSpecSemanticFingerprint({
      inputs: [{ name: 'request', kind: 'json', required: true }],
      outputs: [{ name: 'result', kind: 'json', required: true }],
      language: { primary: 'javascript' },
      validation: { evidenceRequired: true },
      performanceBudget: {
        hotPath: false,
        inputMutation: 'forbidden',
        maxDurationMs: 10000
      }
    }),
    deployScope: 'all-env',
    mutabilityPolicy: 'mutable',
    tags: ['generated', 'provisioning']
  };
}

function normalizeRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw createGeneratorError('ATM_GENERATOR_REQUEST_INVALID', 'Atom generator request must be an object.');
  }
  const bucket = normalizeAtomBucket(request.bucket);
  const title = normalizeRequiredText(request.title, 'title');
  const description = normalizeRequiredText(request.description, 'description');
  const logicalName = request.logicalName ? normalizeLogicalName(request.logicalName) : `atom.${bucket.toLowerCase()}-${slugify(title)}`;

  return {
    bucket,
    title,
    description,
    logicalName
  };
}

function normalizeRequiredText(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createGeneratorError('ATM_GENERATOR_REQUEST_INVALID', `Atom generator request requires ${fieldName}.`, { fieldName });
  }
  return value.trim();
}

function normalizeLogicalName(value) {
  const logicalName = String(value || '').trim().toLowerCase();
  if (!/^atom\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(logicalName)) {
    throw createGeneratorError('ATM_GENERATOR_LOGICAL_NAME_INVALID', 'logicalName must match atom namespace syntax.', { logicalName: value });
  }
  return logicalName;
}

function slugify(value) {
  const slug = String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'generated-atom';
}

function readRegistryDocument(registryAbsolutePath, options) {
  if (options.registryDocument) {
    return options.registryDocument;
  }
  if (!existsSync(registryAbsolutePath)) {
    return createRegistryDocument([], {
      registryId: 'registry.atoms',
      generatedAt: options.now ?? new Date().toISOString()
    });
  }
  try {
    return JSON.parse(readFileSync(registryAbsolutePath, 'utf8'));
  } catch (error) {
    throw createGeneratorError('ATM_REGISTRY_INVALID', 'Atomic registry JSON is invalid.', {
      registryPath: toPortablePath(registryAbsolutePath),
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

function findExistingEntry(registryDocument, request) {
  const entries = Array.isArray(registryDocument?.entries) ? registryDocument.entries : [];
  return entries.find((entry) => entry?.logicalName === request.logicalName) ?? null;
}

function allocateGeneratorAtomId(request, options) {
  const requestedAtomId = options.atomId ?? (options.force === true ? options.existingEntry?.atomId : null);
  if (requestedAtomId) {
    const parsed = parseAtomId(requestedAtomId);
    if (!parsed) {
      throw createGeneratorError('ATM_GENERATOR_ATOM_ID_INVALID', 'Provided atomId must match ATM-{BUCKET}-{NNNN}.', { atomId: requestedAtomId });
    }
    if (parsed.bucket !== request.bucket) {
      throw createGeneratorError('ATM_GENERATOR_ATOM_ID_BUCKET_MISMATCH', 'Provided atomId bucket must match the generator request bucket.', {
        atomId: requestedAtomId,
        expectedBucket: request.bucket,
        actualBucket: parsed.bucket
      });
    }
    return {
      atomId: parsed.atomId,
      bucket: parsed.bucket,
      sequence: parsed.sequence,
      source: 'preassigned',
      reservation: options.force === true ? 'force-existing' : 'preassigned'
    };
  }

  return allocateAtomId(request.bucket, {
    repositoryRoot: options.repositoryRoot,
    registryPath: options.registryPath,
    registryDocument: options.registryDocument
  });
}

function upsertRegistryEntry(registryDocument, registryEntry, options = {}) {
  const entries = Array.isArray(registryDocument?.entries) ? registryDocument.entries : [];
  const existingIndex = entries.findIndex((entry) => entry?.atomId === registryEntry.atomId || entry?.logicalName === registryEntry.logicalName);
  const nextEntries = existingIndex >= 0
    ? entries.map((entry, index) => index === existingIndex ? registryEntry : entry)
    : [...entries, registryEntry];
  return {
    schemaId: registryDocument?.schemaId ?? 'atm.registry',
    specVersion: registryDocument?.specVersion ?? '0.1.0',
    migration: registryDocument?.migration ?? {
      strategy: 'none',
      fromVersion: null,
      notes: 'Generated by AtomGenerator provisioning facade.'
    },
    registryId: registryDocument?.registryId ?? 'registry.atoms',
    generatedAt: options.generatedAt ?? registryDocument?.generatedAt ?? new Date().toISOString(),
    entries: nextEntries
  };
}

function createAtomPaths(atomId) {
  const workbenchPath = `atomic_workbench/atoms/${atomId}`;
  return {
    workbenchPath,
    specPath: `${workbenchPath}/atom.spec.json`,
    sourcePath: `${workbenchPath}/atom.source.mjs`,
    testPath: `${workbenchPath}/atom.test.ts`,
    reportPath: `${workbenchPath}/atom.test.report.json`
  };
}

function renderDefaultAtomSource(specDocument) {
  const metadata = {
    atomId: specDocument.id,
    logicalName: specDocument.logicalName,
    title: specDocument.title,
    generatedBy: 'atom.core-atom-generator'
  };
  return [
    `export const atomMetadata = Object.freeze(${JSON.stringify(metadata, null, 2)});`,
    '',
    'export function runAtom(input = {}) {',
    '  return {',
    '    ok: true,',
    '    atomId: atomMetadata.atomId,',
    '    logicalName: atomMetadata.logicalName,',
    '    input',
    '  };',
    '}',
    '',
    'export function selfCheck() {',
    `  return atomMetadata.atomId === ${JSON.stringify(specDocument.id)} && atomMetadata.logicalName === ${JSON.stringify(specDocument.logicalName)};`,
    '}',
    '',
    "if (process.argv.includes('--self-check')) {",
    '  if (!selfCheck()) {',
    "    console.error(atomMetadata.atomId + ' source self-check failed');",
    '    process.exit(1);',
    '  }',
    "  console.log(atomMetadata.atomId + ' source self-check ok');",
    '}',
    ''
  ].join('\n');
}

function recordPhase(phases, phase, action) {
  const startedAt = Date.now();
  try {
    const result = action();
    phases.push({ phase, ok: true, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    phases.push({
      phase,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: normalizeError(error)
    });
    throw error;
  }
}

function createSuccess(result) {
  return {
    ok: true,
    ...result
  };
}

function createFailure(error, phases) {
  const normalizedError = normalizeError(error);
  return {
    ok: false,
    atomId: null,
    failedPhase: phases.find((phase) => phase.ok === false)?.phase ?? null,
    error: normalizedError,
    phases
  };
}

function createGeneratorError(code, text, details = {}) {
  const error = new Error(text);
  error.name = 'AtomGeneratorError';
  error.code = code;
  error.details = details;
  return error;
}

function normalizeError(error) {
  if (error instanceof AtomIdAllocationError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }
  return {
    code: error?.code ?? 'ATM_GENERATOR_UNHANDLED',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details ?? {}
  };
}

function normalizeTrailingNewline(value) {
  return String(value).endsWith('\n') ? String(value) : `${value}\n`;
}

function toPortablePath(value) {
  return String(value).replace(/\\/g, '/');
}
