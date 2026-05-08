import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { computeSha256ForContent } from '../hash-lock/hash-lock.mjs';
import { createAtomicMapSemanticFingerprint, normalizeSemanticFingerprint } from '../registry/semantic-fingerprint.ts';
import { createAtomicMapRegistryEntry } from '../registry/map-registry.ts';
import { createRegistryDocument, validateRegistryDocumentFile, writeRegistryArtifacts } from '../registry/registry.mjs';
import { allocateMapId, MapIdAllocationError, parseMapId } from './map-id-allocator.mjs';

const defaultRegistryPath = 'atomic-registry.json';
const defaultCatalogPath = 'atomic_workbench/registry-catalog.md';

export function generateAtomicMap(request, options = {}) {
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
      const paths = createMapPaths(existingEntry.mapId);
      return createSuccess({
        mapId: existingEntry.mapId,
        workbenchPath: existingEntry.location?.workbenchPath ?? paths.workbenchPath,
        specPath: existingEntry.location?.specPath ?? paths.specPath,
        testPath: existingEntry.location?.testPaths?.[0] ?? paths.testPath,
        reportPath: existingEntry.location?.reportPath ?? paths.reportPath,
        registryEntry: existingEntry,
        registryPath,
        catalogPath: defaultCatalogPath,
        allocation: null,
        testRun: null,
        idempotent: true,
        dryRun,
        phases: [recordPhase(phases, 'idempotent-existing-entry', () => ({ existingMapId: existingEntry.mapId }))]
      });
    }

    const allocation = recordPhase(phases, 'allocate-id', () => allocateGeneratorMapId(normalizedRequest, {
      repositoryRoot,
      registryPath,
      registryDocument,
      existingEntry,
      mapId: options.mapId,
      force: options.force === true
    }));
    const paths = createMapPaths(allocation.mapId);
    const specDocument = createMinimalAtomicMapSpec({
      ...normalizedRequest,
      mapId: allocation.mapId
    });
    const specAbsolutePath = path.join(repositoryRoot, paths.specPath);
    const testAbsolutePath = path.join(repositoryRoot, paths.testPath);
    const reportAbsolutePath = path.join(repositoryRoot, paths.reportPath);
    const specExistsBefore = existsSync(specAbsolutePath);
    const testExistsBefore = existsSync(testAbsolutePath);

    if (!dryRun) {
      mkdirSync(path.dirname(specAbsolutePath), { recursive: true });
      if (!specExistsBefore || options.overwriteExisting === true) {
        writeFileSync(specAbsolutePath, `${JSON.stringify(specDocument, null, 2)}\n`, 'utf8');
      }
      if (!testExistsBefore || options.overwriteExisting === true) {
        writeFileSync(testAbsolutePath, normalizeTrailingNewline(options.testContent ?? renderDefaultMapIntegrationTest(specDocument)), 'utf8');
      }
    }

    if (dryRun) {
      return createSuccess({
        mapId: allocation.mapId,
        workbenchPath: paths.workbenchPath,
        specPath: paths.specPath,
        testPath: paths.testPath,
        reportPath: paths.reportPath,
        registryEntry: null,
        registryPath,
        catalogPath: defaultCatalogPath,
        allocation,
        testRun: null,
        idempotent: false,
        dryRun,
        phases
      });
    }

    const testRun = recordPhase(phases, 'test', () => runGeneratedMapTest({
      repositoryRoot,
      specPath: specAbsolutePath,
      testPath: testAbsolutePath,
      reportPath: reportAbsolutePath,
      mapId: allocation.mapId,
      now: options.now
    }));
    if (!testRun.ok) {
      throw createGeneratorError('ATM_MAP_GENERATOR_TEST_FAILED', 'Generated map validation command failed.', { testRun });
    }

    const registryEntry = recordPhase(phases, 'register-entry', () => createAtomicMapRegistryEntry(specDocument, {
      schemaPath: 'schemas/registry/atomic-map.schema.json',
      status: options.status ?? 'draft',
      governanceTier: options.governanceTier ?? 'standard',
      location: createMapLocation(paths),
      evidence: createGeneratedMapEvidence(paths)
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
      throw createGeneratorError('ATM_MAP_GENERATOR_REGISTRY_INVALID', validation.promptReport?.summary ?? 'Updated registry is invalid.', { validation });
    }

    return createSuccess({
      mapId: allocation.mapId,
      workbenchPath: paths.workbenchPath,
      specPath: paths.specPath,
      testPath: paths.testPath,
      reportPath: paths.reportPath,
      registryEntry,
      registryPath: writeResult.registryPath,
      catalogPath: writeResult.catalogPath,
      allocation,
      testRun,
      idempotent: false,
      dryRun,
      phases
    });
  } catch (error) {
    return createFailure(error, phases);
  }
}

export function createMinimalAtomicMapSpec(request) {
  const members = normalizeMembers(request.members);
  const memberIds = new Set(members.map((member) => member.atomId));
  const edges = normalizeEdges(request.edges, memberIds);
  const entrypoints = normalizeEntrypoints(request.entrypoints, memberIds);
  const qualityTargets = normalizeQualityTargets(request.qualityTargets);
  const mapVersion = normalizeSemver(request.mapVersion ?? '0.1.0', 'mapVersion');
  const mapHash = computeAtomicMapHash({ members, edges, entrypoints });
  const pendingSfCalculation = request.pendingSfCalculation === true;
  const semanticFingerprint = pendingSfCalculation
    ? null
    : createAtomicMapSemanticFingerprint({ entrypoints, qualityTargets });

  return {
    schemaId: 'atm.atomicMap',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Generated by AtomicMapGenerator provisioning facade.'
    },
    mapId: normalizeMapId(request.mapId),
    mapVersion,
    members,
    edges,
    entrypoints,
    qualityTargets,
    mapHash,
    semanticFingerprint,
    ...(pendingSfCalculation ? { pendingSfCalculation: true } : {})
  };
}

function normalizeRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw createGeneratorError('ATM_MAP_GENERATOR_REQUEST_INVALID', 'Atomic map generator request must be an object.');
  }

  return {
    members: normalizeMembers(request.members),
    edges: request.edges ?? [],
    entrypoints: request.entrypoints,
    qualityTargets: request.qualityTargets,
    mapVersion: request.mapVersion ?? '0.1.0',
    pendingSfCalculation: request.pendingSfCalculation === true
  };
}

function normalizeMembers(members) {
  if (!Array.isArray(members) || members.length === 0) {
    throw createGeneratorError('ATM_MAP_GENERATOR_REQUEST_INVALID', 'Atomic map generator requires at least one member.', { fieldName: 'members' });
  }

  return members.map((member) => ({
    atomId: normalizeAtomId(member?.atomId, 'members[].atomId'),
    version: normalizeSemver(member?.version, 'members[].version')
  }));
}

function normalizeEdges(edges, memberIds) {
  if (edges == null) {
    return [];
  }
  if (!Array.isArray(edges)) {
    throw createGeneratorError('ATM_MAP_GENERATOR_REQUEST_INVALID', 'Atomic map generator edges must be an array.', { fieldName: 'edges' });
  }

  return edges.map((edge) => {
    const from = normalizeAtomId(edge?.from, 'edges[].from');
    const to = normalizeAtomId(edge?.to, 'edges[].to');
    const binding = normalizeRequiredText(edge?.binding, 'edges[].binding');
    if (!memberIds.has(from) || !memberIds.has(to)) {
      throw createGeneratorError('ATM_MAP_GENERATOR_EDGE_UNKNOWN_MEMBER', 'Edge endpoints must reference declared map members.', {
        from,
        to
      });
    }
    return { from, to, binding };
  });
}

function normalizeEntrypoints(entrypoints, memberIds) {
  if (!Array.isArray(entrypoints) || entrypoints.length === 0) {
    throw createGeneratorError('ATM_MAP_GENERATOR_REQUEST_INVALID', 'Atomic map generator requires at least one entrypoint.', { fieldName: 'entrypoints' });
  }

  const normalized = entrypoints.map((entrypoint) => normalizeAtomId(entrypoint, 'entrypoints[]'));
  for (const entrypoint of normalized) {
    if (!memberIds.has(entrypoint)) {
      throw createGeneratorError('ATM_MAP_GENERATOR_ENTRYPOINT_UNKNOWN_MEMBER', 'Entrypoints must reference declared map members.', {
        entrypoint
      });
    }
  }
  return [...new Set(normalized)];
}

function normalizeQualityTargets(qualityTargets) {
  if (!qualityTargets || typeof qualityTargets !== 'object' || Array.isArray(qualityTargets)) {
    throw createGeneratorError('ATM_MAP_GENERATOR_REQUEST_INVALID', 'Atomic map generator requires qualityTargets object.', { fieldName: 'qualityTargets' });
  }

  const entries = Object.entries(qualityTargets).map(([key, value]) => {
    const normalizedKey = normalizeRequiredText(key, 'qualityTargets key');
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw createGeneratorError('ATM_MAP_GENERATOR_QUALITY_TARGET_INVALID', 'qualityTargets values must be string, number, or boolean.', {
        key: normalizedKey,
        actualType: typeof value
      });
    }
    return [normalizedKey, typeof value === 'string' ? value.trim() : value];
  });

  if (entries.length === 0) {
    throw createGeneratorError('ATM_MAP_GENERATOR_REQUEST_INVALID', 'Atomic map generator requires at least one quality target.', { fieldName: 'qualityTargets' });
  }

  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeAtomId(value, fieldName) {
  const atomId = String(value || '').trim();
  if (!/^ATM-[A-Z][A-Z0-9]*-\d{4}$/.test(atomId)) {
    throw createGeneratorError('ATM_MAP_GENERATOR_ATOM_ID_INVALID', `${fieldName} must match ATM-{BUCKET}-{NNNN}.`, {
      fieldName,
      atomId: value
    });
  }
  return atomId;
}

function normalizeMapId(value) {
  const parsed = parseMapId(value);
  if (!parsed) {
    throw createGeneratorError('ATM_MAP_GENERATOR_MAP_ID_INVALID', 'mapId must match ATM-MAP-{NNNN}.', { mapId: value });
  }
  return parsed.mapId;
}

function normalizeSemver(value, fieldName) {
  const version = String(value || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw createGeneratorError('ATM_MAP_GENERATOR_VERSION_INVALID', `${fieldName} must match semver x.y.z.`, {
      fieldName,
      version: value
    });
  }
  return version;
}

function normalizeRequiredText(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createGeneratorError('ATM_MAP_GENERATOR_REQUEST_INVALID', `Atomic map generator requires ${fieldName}.`, { fieldName });
  }
  return value.trim();
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
  const mapHash = computeAtomicMapHash(request);
  const semanticFingerprint = request.pendingSfCalculation === true
    ? null
    : createAtomicMapSemanticFingerprint(request);
  return entries.find((entry) => entry?.schemaId === 'atm.atomicMap'
    && entry?.mapHash === mapHash
    && normalizeSemanticFingerprint(entry?.semanticFingerprint ?? entry?.mapSemanticFingerprint ?? null) === semanticFingerprint
    && (request.pendingSfCalculation === true ? entry?.pendingSfCalculation === true : true)
    && String(entry?.mapVersion || '').trim() === request.mapVersion) ?? null;
}

function allocateGeneratorMapId(request, options) {
  const requestedMapId = options.mapId ?? (options.force === true ? options.existingEntry?.mapId : null);
  if (requestedMapId) {
    const parsed = parseMapId(requestedMapId);
    if (!parsed) {
      throw createGeneratorError('ATM_MAP_GENERATOR_MAP_ID_INVALID', 'Provided mapId must match ATM-MAP-{NNNN}.', { mapId: requestedMapId });
    }
    return {
      mapId: parsed.mapId,
      bucket: parsed.bucket,
      sequence: parsed.sequence,
      source: 'preassigned',
      reservation: options.force === true ? 'force-existing' : 'preassigned'
    };
  }

  return allocateMapId({
    repositoryRoot: options.repositoryRoot,
    registryPath: options.registryPath,
    registryDocument: options.registryDocument
  });
}

function upsertRegistryEntry(registryDocument, registryEntry, options = {}) {
  const entries = Array.isArray(registryDocument?.entries) ? registryDocument.entries : [];
  const existingIndex = entries.findIndex((entry) => entry?.mapId === registryEntry.mapId);
  const nextEntries = existingIndex >= 0
    ? entries.map((entry, index) => index === existingIndex ? registryEntry : entry)
    : [...entries, registryEntry];
  return {
    schemaId: registryDocument?.schemaId ?? 'atm.registry',
    specVersion: registryDocument?.specVersion ?? '0.1.0',
    migration: registryDocument?.migration ?? {
      strategy: 'none',
      fromVersion: null,
      notes: 'Generated by AtomicMapGenerator provisioning facade.'
    },
    registryId: registryDocument?.registryId ?? 'registry.atoms',
    generatedAt: options.generatedAt ?? registryDocument?.generatedAt ?? new Date().toISOString(),
    entries: nextEntries
  };
}

function createMapPaths(mapId) {
  const workbenchPath = `atomic_workbench/maps/${mapId}`;
  return {
    workbenchPath,
    specPath: `${workbenchPath}/map.spec.json`,
    testPath: `${workbenchPath}/map.integration.test.mjs`,
    reportPath: `${workbenchPath}/map.test.report.json`
  };
}

function createMapLocation(paths) {
  return {
    specPath: paths.specPath,
    codePaths: [],
    testPaths: [paths.testPath],
    reportPath: paths.reportPath,
    workbenchPath: paths.workbenchPath
  };
}

function createGeneratedMapEvidence(paths) {
  return [
    'generator-provenance:generated',
    paths.specPath,
    paths.testPath,
    paths.reportPath
  ];
}

function renderDefaultMapIntegrationTest(specDocument) {
  return [
    "import assert from 'node:assert/strict';",
    "import { readFileSync } from 'node:fs';",
    "",
    "const spec = JSON.parse(readFileSync(new URL('./map.spec.json', import.meta.url), 'utf8'));",
    `assert.equal(spec.schemaId, ${JSON.stringify(specDocument.schemaId)});`,
    `assert.equal(spec.mapId, ${JSON.stringify(specDocument.mapId)});`,
    `assert.equal(spec.mapHash, ${JSON.stringify(specDocument.mapHash)});`,
    specDocument.pendingSfCalculation === true
      ? [
          `assert.equal(spec.pendingSfCalculation, true);`,
          `assert.equal(spec.semanticFingerprint, null);`
        ].join('\n')
      : `assert.equal(spec.semanticFingerprint, ${JSON.stringify(specDocument.semanticFingerprint)});`,
    `assert.deepEqual(spec.entrypoints, ${JSON.stringify(specDocument.entrypoints)});`,
    `assert.deepEqual(spec.members, ${JSON.stringify(specDocument.members)});`,
    `assert.deepEqual(spec.edges, ${JSON.stringify(specDocument.edges)});`,
    `assert.deepEqual(spec.qualityTargets, ${JSON.stringify(specDocument.qualityTargets)});`,
    `console.log(${JSON.stringify(`${specDocument.mapId} map integration self-check ok`)});`,
    ''
  ].join('\n');
}

function runGeneratedMapTest(options) {
  const result = spawnSync(process.execPath, [options.testPath], {
    cwd: options.repositoryRoot,
    encoding: 'utf8'
  });
  const report = {
    mapId: options.mapId,
    executedAt: options.now ?? new Date().toISOString(),
    command: [process.execPath, toPortablePath(path.relative(options.repositoryRoot, options.testPath))],
    specPath: toPortablePath(path.relative(options.repositoryRoot, options.specPath)),
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  };
  writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return {
    ok: report.ok,
    report
  };
}

function createAtomicMapHashPayload(input) {
  return {
    members: [...input.members]
      .map((member) => ({
        atomId: String(member.atomId).trim(),
        version: String(member.version).trim()
      }))
      .sort((left, right) => left.atomId.localeCompare(right.atomId) || left.version.localeCompare(right.version)),
    edges: [...input.edges]
      .map((edge) => ({
        from: String(edge.from).trim(),
        to: String(edge.to).trim(),
        binding: String(edge.binding).trim()
      }))
      .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.binding.localeCompare(right.binding)),
    entrypoints: [...input.entrypoints]
      .map((entrypoint) => String(entrypoint).trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right))
  };
}

function computeAtomicMapHash(input) {
  return computeSha256ForContent(JSON.stringify(createAtomicMapHashPayload(input)));
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
    mapId: null,
    failedPhase: phases.find((phase) => phase.ok === false)?.phase ?? null,
    error: normalizedError,
    phases
  };
}

function createGeneratorError(code, text, details = {}) {
  const error = new Error(text);
  error.name = 'AtomicMapGeneratorError';
  error.code = code;
  error.details = details;
  return error;
}

function normalizeError(error) {
  if (error instanceof MapIdAllocationError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }
  return {
    code: error?.code ?? 'ATM_MAP_GENERATOR_UNHANDLED',
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
