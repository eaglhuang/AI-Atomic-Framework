import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { computeSha256ForContent } from '../hash-lock/hash-lock.ts';
import { createAtomicMapSemanticFingerprint, normalizeSemanticFingerprint } from '../registry/semantic-fingerprint.ts';
import { createAtomicMapRegistryEntry } from '../registry/map-registry.ts';
import { createRegistryDocument, validateRegistryDocumentFile, writeRegistryArtifacts } from '../registry/registry.ts';
import type { AtomicMapReplacementRecord, MapRegistryEntryRecord, RegistryMapEdgeRecord, RegistryMapMemberRecord } from '../index.ts';
import { allocateMapId, MapIdAllocationError, parseMapId } from './map-id-allocator.ts';
import { createGeneratorError, type GeneratorError } from './map-generator/errors.ts';
import {
  assertSpecVersionSupportsMapSurface,
  inferSpecVersion,
  normalizeAtomId,
  normalizeMapId,
  normalizeRequiredText,
  normalizeSemver,
  normalizeSpecVersion
} from './map-generator/normalize-fields.ts';
import {
  normalizeOptionalEdgeKind,
  normalizeOptionalMemberRole,
  normalizeReplacement
} from './map-generator/normalize-lineage.ts';

const defaultRegistryPath = 'atomic-registry.json';
const defaultCatalogPath = 'atomic_workbench/registry-catalog.md';

// ─── Domain types ──────────────────────────────────────────────────────────

interface MapMember {
  atomId: string;
  version: string;
  role?: string;
  versionLineage?: string;
}

interface MapEdge {
  from: string;
  to: string;
  binding: string;
  edgeKind?: string;
}

interface MapReplacement {
  legacyUris: string[];
  mode?: string;
  evidenceRefs?: string[];
}

interface NormalizedRequest {
  members: MapMember[];
  edges: MapEdge[];
  entrypoints: string[];
  qualityTargets: Record<string, string | number | boolean>;
  mapVersion: string;
  specVersion?: string;
  replacement?: MapReplacement | null;
  pendingSfCalculation?: boolean;
}

interface MapPaths {
  workbenchPath: string;
  specPath: string;
  testPath: string;
  reportPath: string;
}

interface GenerateAtomicMapOptions {
  repositoryRoot?: string;
  registryPath?: string;
  dryRun?: boolean;
  force?: boolean;
  mapId?: string | null;
  status?: string;
  governanceTier?: string;
  catalogPath?: string;
  now?: string;
  overwriteExisting?: boolean;
  testContent?: string;
  registryDocument?: Record<string, unknown>;
}

/** Unified result shape returned by generateAtomicMap */
export interface GenerateAtomicMapResult {
  ok: boolean;
  mapId: string | null;
  workbenchPath?: string | null;
  specPath?: string | null;
  testPath?: string | null;
  reportPath?: string | null;
  registryEntry?: RegistryEntry | null;
  registryPath?: string | null;
  catalogPath?: string | null;
  allocation?: MapIdAllocationRecord | null;
  testRun?: unknown | null;
  idempotent?: boolean;
  dryRun?: boolean;
  phases: PhaseRecord[];
  failedPhase?: string | null;
  error?: { code: string; message: string; details: Record<string, unknown> };
}

interface PhaseRecord {
  phase: string;
  ok: boolean;
  durationMs: number;
  error?: ReturnType<typeof normalizeError>;
}

interface RegistryEntry {
  mapId: string;
  schemaId?: string;
  specVersion?: string;
  mapVersion?: string;
  members?: readonly RegistryMapMemberRecord[];
  edges?: readonly RegistryMapEdgeRecord[];
  replacement?: AtomicMapReplacementRecord;
  evidence?: readonly string[];
  location?: {
    workbenchPath?: string;
    specPath?: string;
    testPaths?: string[];
    reportPath?: string;
  };
}

interface MapIdAllocationRecord {
  mapId: string;
  bucket: string;
  sequence: number;
  source: string;
  reservation: string | null;
}

interface RegistryDocument {
  schemaId?: string;
  specVersion?: string;
  migration?: Record<string, unknown>;
  registryId?: string;
  generatedAt?: string;
  entries?: unknown[];
}

interface AllocateOptions {
  repositoryRoot: string;
  registryPath: string;
  registryDocument: RegistryDocument;
  existingEntry: RegistryEntry | null;
  mapId?: string;
  force: boolean;
}

export function generateAtomicMap(request: unknown, options: GenerateAtomicMapOptions = {}): GenerateAtomicMapResult {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const registryPath = options.registryPath ?? defaultRegistryPath;
  const registryAbsolutePath = path.resolve(repositoryRoot, registryPath);
  const dryRun = options.dryRun === true;
  const phases: PhaseRecord[] = [];

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
      mapId: options.mapId ?? undefined,
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registryEntry = recordPhase(phases, 'register-entry', () => createAtomicMapRegistryEntry(specDocument as any, {
      schemaPath: 'schemas/registry/atomic-map.schema.json',
      status: options.status ?? 'draft',
      governanceTier: options.governanceTier ?? 'standard',
      location: createMapLocation(paths),
      evidence: createGeneratedMapEvidence(paths)
    })) as MapRegistryEntryRecord;
    const updatedRegistryDocument = upsertRegistryEntry(registryDocument, registryEntry as unknown as RegistryEntry, {
      generatedAt: options.now ?? new Date().toISOString()
    });
    const writeResult = recordPhase(phases, 'write-registry', () => writeRegistryArtifacts(updatedRegistryDocument as unknown as Record<string, unknown>, {
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

export function createMinimalAtomicMapSpec(request: NormalizedRequest & { mapId: string }) {
  const members = normalizeMembers(request.members);
  const memberIds = new Set(members.map((member) => member.atomId));
  const edges = normalizeEdges(request.edges, memberIds);
  const entrypoints = normalizeEntrypoints(request.entrypoints, memberIds);
  const qualityTargets = normalizeQualityTargets(request.qualityTargets);
  const mapVersion = normalizeSemver(request.mapVersion ?? '0.1.0', 'mapVersion');
  const replacement = normalizeReplacement(request.replacement);
  const specVersion = normalizeSpecVersion(request.specVersion ?? inferSpecVersion({ members, edges, replacement }));
  assertSpecVersionSupportsMapSurface(specVersion, { members, edges, replacement });
  const mapHash = computeAtomicMapHash({ members, edges, entrypoints, replacement });
  const pendingSfCalculation = request.pendingSfCalculation === true;
  const semanticFingerprint = pendingSfCalculation
    ? null
    : createAtomicMapSemanticFingerprint({ entrypoints, qualityTargets });

  return {
    schemaId: 'atm.atomicMap',
    specVersion,
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
    ...(replacement ? { replacement } : {}),
    semanticFingerprint,
    ...(pendingSfCalculation ? { pendingSfCalculation: true } : {})
  };
}

function normalizeRequest(request: unknown): NormalizedRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw createGeneratorError('ATM_MAP_GENERATOR_REQUEST_INVALID', 'Atomic map generator request must be an object.');
  }

  const req = request as Record<string, unknown>;
  return {
    members: normalizeMembers(req.members),
    edges: (req.edges as MapEdge[] | undefined) ?? [],
    entrypoints: req.entrypoints as string[],
    qualityTargets: req.qualityTargets as Record<string, string | number | boolean>,
    mapVersion: (req.mapVersion as string | undefined) ?? '0.1.0',
    specVersion: req.specVersion as string | undefined,
    replacement: normalizeReplacement(req.replacement),
    pendingSfCalculation: req.pendingSfCalculation === true
  };
}

function normalizeMembers(members: unknown): MapMember[] {
  if (!Array.isArray(members) || members.length === 0) {
    throw createGeneratorError('ATM_MAP_GENERATOR_REQUEST_INVALID', 'Atomic map generator requires at least one member.', { fieldName: 'members' });
  }

  return members.map((member: unknown) => {
    const m = member as Record<string, unknown> | null | undefined;
    return {
      atomId: normalizeAtomId(m?.atomId, 'members[].atomId'),
      version: normalizeSemver(m?.version, 'members[].version'),
      ...normalizeOptionalMemberRole(m?.role),
      ...(m?.versionLineage ? { versionLineage: m.versionLineage as string } : {})
    };
  });
}

function normalizeEdges(edges: unknown, memberIds: Set<string>): MapEdge[] {
  if (edges == null) {
    return [];
  }
  if (!Array.isArray(edges)) {
    throw createGeneratorError('ATM_MAP_GENERATOR_REQUEST_INVALID', 'Atomic map generator edges must be an array.', { fieldName: 'edges' });
  }

  return edges.map((edge: unknown) => {
    const e = edge as Record<string, unknown> | null | undefined;
    const from = normalizeAtomId(e?.from, 'edges[].from');
    const to = normalizeAtomId(e?.to, 'edges[].to');
    const binding = normalizeRequiredText(e?.binding, 'edges[].binding');
    if (!memberIds.has(from) || !memberIds.has(to)) {
      throw createGeneratorError('ATM_MAP_GENERATOR_EDGE_UNKNOWN_MEMBER', 'Edge endpoints must reference declared map members.', {
        from,
        to
      });
    }
    return {
      from,
      to,
      binding,
      ...normalizeOptionalEdgeKind(e?.edgeKind)
    };
  });
}

function normalizeEntrypoints(entrypoints: unknown, memberIds: Set<string>): string[] {
  if (!Array.isArray(entrypoints) || entrypoints.length === 0) {
    throw createGeneratorError('ATM_MAP_GENERATOR_REQUEST_INVALID', 'Atomic map generator requires at least one entrypoint.', { fieldName: 'entrypoints' });
  }

  const normalized = entrypoints.map((entrypoint: unknown) => normalizeAtomId(entrypoint, 'entrypoints[]'));
  for (const entrypoint of normalized) {
    if (!memberIds.has(entrypoint)) {
      throw createGeneratorError('ATM_MAP_GENERATOR_ENTRYPOINT_UNKNOWN_MEMBER', 'Entrypoints must reference declared map members.', {
        entrypoint
      });
    }
  }
  return [...new Set(normalized)];
}

function normalizeQualityTargets(qualityTargets: unknown): Record<string, string | number | boolean> {
  if (!qualityTargets || typeof qualityTargets !== 'object' || Array.isArray(qualityTargets)) {
    throw createGeneratorError('ATM_MAP_GENERATOR_REQUEST_INVALID', 'Atomic map generator requires qualityTargets object.', { fieldName: 'qualityTargets' });
  }

  const entries = Object.entries(qualityTargets as Record<string, string | number | boolean>).map(([key, value]) => {
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

  return Object.fromEntries((entries as Array<[string, string | number | boolean]>).sort(([left], [right]) => left.localeCompare(right)));
}

function readRegistryDocument(registryAbsolutePath: string, options: GenerateAtomicMapOptions): RegistryDocument {
  if (options.registryDocument) {
    return options.registryDocument as RegistryDocument;
  }
  if (!existsSync(registryAbsolutePath)) {
    return createRegistryDocument([], {
      registryId: 'registry.atoms',
      generatedAt: options.now ?? new Date().toISOString()
    }) as RegistryDocument;
  }
  try {
    return JSON.parse(readFileSync(registryAbsolutePath, 'utf8')) as RegistryDocument;
  } catch (error) {
    throw createGeneratorError('ATM_REGISTRY_INVALID', 'Atomic registry JSON is invalid.', {
      registryPath: toPortablePath(registryAbsolutePath),
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

function findExistingEntry(registryDocument: RegistryDocument, request: NormalizedRequest): RegistryEntry | null {
  const entries = Array.isArray(registryDocument?.entries) ? registryDocument.entries : [];
  const mapHash = computeAtomicMapHash({
    ...request,
    replacement: request.replacement ?? null
  });
  const semanticFingerprint = request.pendingSfCalculation === true
    ? null
    : createAtomicMapSemanticFingerprint(request);
  return (entries as RegistryEntry[]).find((entry) => {
    const e = entry as unknown as Record<string, unknown>;
    return e?.schemaId === 'atm.atomicMap'
      && e?.mapHash === mapHash
      && normalizeSemanticFingerprint((e?.semanticFingerprint ?? e?.mapSemanticFingerprint ?? null) as unknown) === semanticFingerprint
      && (request.pendingSfCalculation === true ? e?.pendingSfCalculation === true : true)
      && String(e?.mapVersion || '').trim() === request.mapVersion;
  }) ?? null;
}

function allocateGeneratorMapId(request: NormalizedRequest, options: AllocateOptions) {
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
    } satisfies MapIdAllocationRecord;
  }

  return allocateMapId({
    repositoryRoot: options.repositoryRoot,
    registryPath: options.registryPath,
    registryDocument: options.registryDocument
  }) as MapIdAllocationRecord;
}

function upsertRegistryEntry(registryDocument: RegistryDocument, registryEntry: RegistryEntry, options: { generatedAt?: string } = {}): RegistryDocument {
  const entries = Array.isArray(registryDocument?.entries) ? registryDocument.entries : [];
  const existingIndex = (entries as RegistryEntry[]).findIndex((entry) => entry?.mapId === registryEntry.mapId);
  const nextEntries = existingIndex >= 0
    ? (entries as RegistryEntry[]).map((entry, index) => index === existingIndex ? registryEntry : entry)
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

function createMapPaths(mapId: string): MapPaths {
  const workbenchPath = `atomic_workbench/maps/${mapId}`;
  return {
    workbenchPath,
    specPath: `${workbenchPath}/map.spec.json`,
    testPath: `${workbenchPath}/map.integration.test.ts`,
    reportPath: `${workbenchPath}/map.test.report.json`
  };
}

function createMapLocation(paths: MapPaths) {
  return {
    specPath: paths.specPath,
    codePaths: [],
    testPaths: [paths.testPath],
    reportPath: paths.reportPath,
    workbenchPath: paths.workbenchPath
  };
}

function createGeneratedMapEvidence(paths: MapPaths): string[] {
  return [
    'generator-provenance:generated',
    paths.specPath,
    paths.testPath,
    paths.reportPath
  ];
}

function renderDefaultMapIntegrationTest(specDocument: Record<string, unknown>): string {
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

interface RunTestOptions {
  repositoryRoot: string;
  specPath: string;
  testPath: string;
  reportPath: string;
  mapId: string;
  now?: string;
}

function runGeneratedMapTest(options: RunTestOptions) {
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

interface HashPayloadMember {
  atomId: string;
  version: string;
  role?: string;
}

interface HashPayloadEdge {
  from: string;
  to: string;
  binding: string;
  edgeKind?: string;
}

interface HashPayloadInput {
  members: HashPayloadMember[];
  edges: HashPayloadEdge[];
  entrypoints: string[];
  replacement: MapReplacement | null;
}

function createAtomicMapHashPayload(input: HashPayloadInput) {
  return {
    members: [...input.members]
      .map((member) => ({
        atomId: String(member.atomId).trim(),
        version: String(member.version).trim(),
        ...(member.role ? { role: String(member.role).trim() } : {})
      }))
      .sort((left, right) => left.atomId.localeCompare(right.atomId) || left.version.localeCompare(right.version) || String((left as { role?: string }).role ?? '').localeCompare(String((right as { role?: string }).role ?? ''))),
    edges: [...input.edges]
      .map((edge) => ({
        from: String(edge.from).trim(),
        to: String(edge.to).trim(),
        binding: String(edge.binding).trim(),
        ...(edge.edgeKind ? { edgeKind: String(edge.edgeKind).trim() } : {})
      }))
      .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.binding.localeCompare(right.binding) || String((left as { edgeKind?: string }).edgeKind ?? '').localeCompare(String((right as { edgeKind?: string }).edgeKind ?? ''))),
    entrypoints: [...input.entrypoints]
      .map((entrypoint) => String(entrypoint).trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right)),
    ...(input.replacement ? { replacement: normalizeAtomicMapReplacementForHash(input.replacement) } : {})
  };
}

function computeAtomicMapHash(input: HashPayloadInput): string {
  return computeSha256ForContent(JSON.stringify(createAtomicMapHashPayload(input)));
}

function normalizeAtomicMapReplacementForHash(replacement: MapReplacement) {
  return {
    legacyUris: [...replacement.legacyUris]
      .map((legacyUri) => String(legacyUri).trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right))
  };
}

function recordPhase<T>(phases: PhaseRecord[], phase: string, action: () => T): T {
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

function createSuccess<T extends Record<string, unknown>>(result: T): GenerateAtomicMapResult {
  return {
    ok: true,
    phases: [],
    ...result
  } as unknown as GenerateAtomicMapResult;
}

function createFailure(error: unknown, phases: PhaseRecord[]): GenerateAtomicMapResult {
  const normalizedError = normalizeError(error);
  return {
    ok: false,
    mapId: null,
    failedPhase: phases.find((phase) => phase.ok === false)?.phase ?? null,
    error: normalizedError,
    phases
  };
}

function normalizeError(error: unknown) {
  if (error instanceof MapIdAllocationError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }
  const typedError = error as Partial<GeneratorError> | undefined;
  return {
    code: typedError?.code ?? 'ATM_MAP_GENERATOR_UNHANDLED',
    message: error instanceof Error ? error.message : String(error),
    details: typedError?.details ?? {}
  };
}

function normalizeTrailingNewline(value: string): string {
  return String(value).endsWith('\n') ? String(value) : `${value}\n`;
}

function toPortablePath(value: string): string {
  return String(value).replace(/\\/g, '/');
}
