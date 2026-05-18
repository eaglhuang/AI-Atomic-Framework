import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { resolveCanonicalMapPaths, resolveMapIntegrationTarget } from '../test-runner/map-integration.ts';
import { createTestReportMetrics } from '../test-runner/metrics-collector.ts';

export const defaultMapEquivalenceReportMigration = Object.freeze({
  strategy: 'none',
  fromVersion: null,
  notes: 'Initial alpha0 map equivalence report.'
});

type MetricDirection = 'higher-is-better' | 'lower-is-better' | 'informational';

interface FixtureCaseRecord {
  readonly caseId: string;
  readonly input: unknown;
  readonly metric: unknown;
  readonly evidenceRefs: unknown;
  readonly knownDivergence: boolean;
}

interface KnownDivergenceRecord {
  readonly caseId: string;
  readonly reason: string;
  readonly justification: string;
  readonly reviewer: string;
  readonly reviewRef: string;
}

interface CaseMetricRecord {
  readonly name: string;
  readonly baseline: number;
  readonly current: number;
  readonly delta: number;
  readonly direction: MetricDirection;
  readonly passed: boolean;
  readonly tolerance?: number;
}

interface ReportCaseRecord {
  readonly caseId: string;
  readonly input: unknown;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly metric: CaseMetricRecord;
  readonly evidenceRefs: string[];
  readonly passed: boolean;
  readonly knownDivergence: boolean;
}

export function resolveMapEquivalencePaths(mapId: string) {
  const canonical = resolveCanonicalMapPaths(mapId);
  return {
    workbenchPath: canonical.workbenchPath,
    specPath: canonical.specPath,
    testPath: canonical.testPath,
    reportPath: `${canonical.workbenchPath}/map.equivalence.report.json`
  };
}

export async function runMapEquivalence(mapId: string, fixturePath: string, options: any = {}) {
  const target = resolveMapIntegrationTarget(mapId, options);
  const repositoryRoot = target.repositoryRoot;
  const specAbsolutePath = path.join(repositoryRoot, target.specPath);
  const fixtureAbsolutePath = path.resolve(repositoryRoot, fixturePath);
  if (!existsSync(fixtureAbsolutePath)) {
    throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_FIXTURES_NOT_FOUND', 'Map equivalence fixtures file was not found.', {
      mapId,
      fixturePath
    });
  }

  const specDocument = readJson(specAbsolutePath);
  const legacyUris = normalizeLegacyUris(specDocument?.replacement?.legacyUris);
  if (legacyUris.length === 0) {
    throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_REPLACEMENT_REQUIRED', 'Map equivalence requires replacement.legacyUris on the target map spec.', {
      mapId,
      specPath: target.specPath
    });
  }

  const fixtureSet = readJson(fixtureAbsolutePath);
  if (fixtureSet?.mapId && String(fixtureSet.mapId).trim() !== mapId) {
    throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_MAP_MISMATCH', 'Fixture set mapId does not match the requested map.', {
      expectedMapId: mapId,
      fixtureMapId: fixtureSet.mapId
    });
  }

  const cases = normalizeFixtureCases(fixtureSet?.cases);
  const mapExecutor = await loadExecutor(repositoryRoot, fixtureSet?.mapExecutor, 'mapExecutor');
  const legacyExecutor = await loadExecutor(repositoryRoot, fixtureSet?.legacyExecutor, 'legacyExecutor');
  const knownDivergences = normalizeKnownDivergences(fixtureSet?.knownDivergences);
  const documentedKnownDivergences = new Map(knownDivergences.map((entry) => [entry.caseId, entry]));
  const startedAt = Date.now();

  const reportCases: ReportCaseRecord[] = [];
  for (const fixtureCase of cases) {
    const executionContext = {
      mapId,
      legacyUris: [...legacyUris],
      caseId: fixtureCase.caseId,
      fixtureSetId: normalizeFixtureSetId(fixtureSet?.fixtureSetId, fixtureAbsolutePath)
    };
    const expected = await invokeExecutor(legacyExecutor, fixtureCase.input, executionContext, 'legacyExecutor', fixtureCase.caseId);
    const actual = await invokeExecutor(mapExecutor, fixtureCase.input, executionContext, 'mapExecutor', fixtureCase.caseId);
    const passed = isDeepStrictEqual(expected, actual);
    reportCases.push({
      caseId: fixtureCase.caseId,
      input: fixtureCase.input,
      expected,
      actual,
      metric: createCaseMetric(fixtureCase.metric, passed),
      evidenceRefs: normalizeEvidenceRefs(fixtureCase.evidenceRefs, fixtureCase.caseId),
      passed,
      knownDivergence: fixtureCase.knownDivergence === true
    });
  }

  const durationMs = Date.now() - startedAt;
  const documentedKnownDivergenceIds = reportCases
    .filter((entry) => entry.knownDivergence === true && documentedKnownDivergences.has(entry.caseId))
    .map((entry) => entry.caseId);
  const acceptedKnownDivergenceIds = reportCases
    .filter((entry) => entry.passed === false && documentedKnownDivergences.has(entry.caseId))
    .map((entry) => entry.caseId);
  const failedCaseIds = reportCases
    .filter((entry) => entry.passed === false && !documentedKnownDivergences.has(entry.caseId))
    .map((entry) => entry.caseId);
  const reportPaths = resolveMapEquivalencePaths(mapId);
  const relativeFixturePath = toPortablePath(path.relative(repositoryRoot, fixtureAbsolutePath));
  const filteredKnownDivergences = knownDivergences.filter((entry) => reportCases.some((fixtureCase) => fixtureCase.caseId === entry.caseId));
  const report = createMapEquivalenceReport({
    mapId,
    repositoryRoot,
    generatedAt: options.now ?? new Date().toISOString(),
    specPath: target.specPath,
    fixturePath: relativeFixturePath,
    reportPath: reportPaths.reportPath,
    legacyUris,
    fixtureSetId: normalizeFixtureSetId(fixtureSet?.fixtureSetId, fixtureAbsolutePath),
    cases: reportCases,
    knownDivergences: filteredKnownDivergences,
    documentedKnownDivergenceIds,
    failedCaseIds,
    durationMs
  });

  if (options.writeReport !== false) {
    const reportAbsolutePath = path.join(repositoryRoot, reportPaths.reportPath);
    mkdirSync(path.dirname(reportAbsolutePath), { recursive: true });
    writeFileSync(reportAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  return {
    ok: report.passed,
    mapId,
    reportPath: reportPaths.reportPath,
    fixturePath: relativeFixturePath,
    legacyUris,
    resolutionMode: target.resolutionMode,
    warnings: [...target.warnings],
    acceptedKnownDivergenceIds,
    failedCaseIds,
    report
  };
}

export function createMapEquivalenceReport(input: any) {
  const cases = [...(input.cases ?? [])];
  const documentedKnownDivergenceIds = new Set(input.documentedKnownDivergenceIds ?? []);
  const totalCases = cases.length;
  const passedCases = cases.filter((entry) => entry.passed === true).length;
  const failedCases = cases.filter((entry) => entry.passed !== true).length;
  const failedCaseIds = [...(input.failedCaseIds ?? [])];
  const passed = failedCaseIds.length === 0;
  const reportId = createReportId(input.mapId, input.fixtureSetId);

  return {
    schemaId: 'atm.mapEquivalenceReport',
    specVersion: '0.1.0',
    migration: defaultMapEquivalenceReportMigration,
    reportId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    mapId: input.mapId,
    legacyUris: [...(input.legacyUris ?? [])],
    fixtures: [
      {
        fixtureId: normalizeFixtureSetId(input.fixtureSetId, input.fixturePath),
        path: input.fixturePath,
        description: 'Deterministic fixture set for delegated map equivalence execution.'
      }
    ],
    cases,
    ...(input.knownDivergences?.length > 0 ? { knownDivergences: [...input.knownDivergences] } : {}),
    summary: {
      totalCases,
      passedCases,
      failedCases,
      knownDivergenceCount: documentedKnownDivergenceIds.size
    },
    metrics: createTestReportMetrics({
      total: totalCases,
      failed: failedCaseIds.length,
      coverage: totalCases > 0 ? passedCases / totalCases : 1,
      edgeCaseCount: documentedKnownDivergenceIds.size,
      latency: input.durationMs
    }),
    artifacts: [
      {
        artifactPath: input.reportPath,
        artifactKind: 'report',
        producedBy: 'map-equivalence-runner'
      },
      {
        artifactPath: input.specPath,
        artifactKind: 'file',
        producedBy: 'map-equivalence-runner'
      },
      {
        artifactPath: input.fixturePath,
        artifactKind: 'file',
        producedBy: 'map-equivalence-runner'
      }
    ],
    evidence: [
      {
        evidenceKind: 'validation',
        signalScope: 'atom-map',
        atomMapId: input.mapId,
        summary: passed
          ? (documentedKnownDivergenceIds.size > 0
            ? `Map equivalence passed with ${documentedKnownDivergenceIds.size} documented known divergence(s).`
            : 'Map equivalence passed for all fixtures.')
          : `Map equivalence failed for case ids: ${failedCaseIds.join(', ')}.`,
        artifactPaths: [input.reportPath, input.specPath, input.fixturePath]
      }
    ],
    passed
  };
}

async function loadExecutor(repositoryRoot: string, descriptor: any, fieldName: string) {
  const modulePath = String(descriptor?.modulePath || '').trim();
  if (!modulePath) {
    throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_FIXTURES_INVALID', `${fieldName}.modulePath is required.`, {
      fieldName
    });
  }
  const exportName = String(descriptor?.exportName || 'run').trim();
  const absoluteModulePath = path.resolve(repositoryRoot, modulePath);
  if (!existsSync(absoluteModulePath)) {
    throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_EXECUTOR_NOT_FOUND', `${fieldName} module was not found.`, {
      fieldName,
      modulePath
    });
  }
  const module = await import(`${pathToFileURL(absoluteModulePath).href}?equivalenceExecutor=${Date.now()}`);
  const executor = module[exportName];
  if (typeof executor !== 'function') {
    throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_EXECUTOR_INVALID', `${fieldName}.${exportName} must be a function.`, {
      fieldName,
      modulePath,
      exportName
    });
  }
  return executor;
}

async function invokeExecutor(executor: any, input: any, context: any, fieldName: string, caseId: string) {
  try {
    return await executor(input, context);
  } catch (error) {
    throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_EXECUTOR_FAILED', `${fieldName} failed while running ${caseId}.`, {
      fieldName,
      caseId,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

function normalizeFixtureCases(value: any): FixtureCaseRecord[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_FIXTURES_INVALID', 'Fixture set must define at least one case.', {});
  }
  return value.map((entry, index) => {
    const caseId = String(entry?.caseId || '').trim();
    if (!caseId) {
      throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_FIXTURES_INVALID', `Fixture case at index ${index} is missing caseId.`, {
        index
      });
    }
    return {
      caseId,
      input: entry?.input ?? null,
      metric: entry?.metric ?? null,
      evidenceRefs: entry?.evidenceRefs,
      knownDivergence: entry?.knownDivergence === true
    };
  });
}

function normalizeKnownDivergences(value: any): KnownDivergenceRecord[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_FIXTURES_INVALID', 'knownDivergences must be an array when provided.', {});
  }
  return value.map((entry, index) => {
    const normalized = {
      caseId: String(entry?.caseId || '').trim(),
      reason: String(entry?.reason || '').trim(),
      justification: String(entry?.justification || '').trim(),
      reviewer: String(entry?.reviewer || '').trim(),
      reviewRef: String(entry?.reviewRef || '').trim()
    };
    for (const [fieldName, fieldValue] of Object.entries(normalized)) {
      if (!fieldValue) {
        throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_FIXTURES_INVALID', `knownDivergences[${index}].${fieldName} is required.`, {
          index,
          fieldName
        });
      }
    }
    return normalized;
  });
}

function createCaseMetric(metric: any, passed: boolean): CaseMetricRecord {
  const baseline = typeof metric?.baseline === 'number' ? metric.baseline : 1;
  const current = typeof metric?.current === 'number'
    ? metric.current
    : (passed ? baseline : 0);
  const output: CaseMetricRecord = {
    name: String(metric?.name || 'semanticMatch').trim(),
    baseline,
    current,
    delta: current - baseline,
    direction: normalizeMetricDirection(metric?.direction),
    passed
  };
  if (typeof metric?.tolerance === 'number' && metric.tolerance >= 0) {
    return {
      ...output,
      tolerance: metric.tolerance
    };
  }
  return output;
}

function normalizeEvidenceRefs(value: any, caseId: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [`equivalence-fixture:${caseId}`];
  }
  const normalized = value.map((entry) => String(entry || '').trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : [`equivalence-fixture:${caseId}`];
}

function normalizeMetricDirection(value: any): MetricDirection {
  const direction = String(value || 'higher-is-better').trim();
  if (direction === 'higher-is-better' || direction === 'lower-is-better' || direction === 'informational') {
    return direction;
  }
  return 'higher-is-better';
}

function normalizeLegacyUris(value: any): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry || '').trim()).filter(Boolean);
}

function normalizeFixtureSetId(value: any, fallbackSource: string) {
  const explicit = String(value || '').trim();
  if (explicit) {
    return explicit;
  }
  return `fixture.${path.basename(fallbackSource, path.extname(fallbackSource)).replace(/[^a-zA-Z0-9.-]+/g, '-').toLowerCase()}`;
}

function createReportId(mapId: string, fixtureSetId: string) {
  return `map-equivalence.${String(mapId).toLowerCase()}.${normalizeFixtureSetId(fixtureSetId, fixtureSetId).replace(/^fixture\./, '')}`;
}

function readJson(filePath: string) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw createMapEquivalenceError('ATM_MAP_EQUIVALENCE_JSON_INVALID', 'Failed to parse JSON input for map equivalence.', {
      filePath: toPortablePath(filePath),
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

function createMapEquivalenceError(code: string, message: string, details: Record<string, unknown>) {
  const error = new Error(message) as Error & { code: string; details: Record<string, unknown> };
  error.name = 'MapEquivalenceRunnerError';
  error.code = code;
  error.details = details;
  return error;
}

function toPortablePath(value: string) {
  return String(value || '').replace(/\\/g, '/');
}
