import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createTestReportMetrics } from './metrics-collector.ts';

export const defaultMapIntegrationReportMigration = Object.freeze({
  strategy: 'none',
  fromVersion: null,
  notes: 'Initial alpha0 map integration report.'
});

export function resolveCanonicalMapPaths(mapId) {
  const workbenchPath = `atomic_workbench/maps/${mapId}`;
  return {
    workbenchPath,
    specPath: `${workbenchPath}/map.spec.json`,
    testPath: `${workbenchPath}/map.integration.test.mjs`,
    reportPath: `${workbenchPath}/map.test.report.json`
  };
}

export function resolveMapIntegrationTarget(mapId, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const canonical = resolveCanonicalMapPaths(mapId);
  const canonicalSpecPath = path.join(repositoryRoot, canonical.specPath);
  const canonicalTestPath = path.join(repositoryRoot, canonical.testPath);
  if (existsSync(canonicalSpecPath) && existsSync(canonicalTestPath)) {
    return {
      mapId,
      repositoryRoot,
      resolutionMode: 'canonical',
      workbenchPath: canonical.workbenchPath,
      specPath: canonical.specPath,
      testPath: canonical.testPath,
      reportPath: canonical.reportPath,
      warnings: []
    };
  }

  const legacy = resolveLegacyMapTarget(mapId, { repositoryRoot });
  if (legacy) {
    return {
      mapId,
      repositoryRoot,
      resolutionMode: 'legacy',
      workbenchPath: legacy.workbenchPath,
      specPath: legacy.specPath,
      testPath: legacy.testPath,
      reportPath: canonical.reportPath,
      warnings: [`ATM_MAP_TEST_LEGACY_FALLBACK:${legacy.workbenchPath}`]
    };
  }

  throw createMapRunnerError('ATM_MAP_TEST_TARGET_NOT_FOUND', 'Atomic map integration target was not found.', {
    mapId,
    searched: [canonical.workbenchPath, 'atomic_workbench/atoms/*/map/']
  });
}

export function runMapIntegrationTest(mapId, options = {}) {
  const target = resolveMapIntegrationTarget(mapId, options);
  const generatedAt = options.now ?? new Date().toISOString();
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [path.join(target.repositoryRoot, target.testPath)], {
    cwd: target.repositoryRoot,
    encoding: 'utf8'
  });
  const durationMs = Date.now() - startedAt;
  const mapStatus = {
    mapId,
    ok: typeof result.status === 'number' ? result.status === 0 : false,
    exitCode: typeof result.status === 'number' ? result.status : 1,
    durationMs,
    resolutionMode: target.resolutionMode,
    reportPath: target.reportPath,
    stdout: normalizeText(result.stdout),
    stderr: [normalizeText(result.stderr), result.error?.message ?? ''].filter(Boolean).join('\n'),
    warnings: [...target.warnings]
  };
  const report = createMapIntegrationReport({
    mapId,
    repositoryRoot: target.repositoryRoot,
    generatedAt,
    specPath: target.specPath,
    testPath: target.testPath,
    reportPath: target.reportPath,
    resolutionMode: target.resolutionMode,
    warnings: target.warnings,
    perMapStatus: [mapStatus],
    failedDownstream: mapStatus.ok ? [] : [mapId],
    propagationDuration: durationMs
  });

  if (options.writeReport !== false) {
    const reportAbsolutePath = path.join(target.repositoryRoot, target.reportPath);
    mkdirSync(path.dirname(reportAbsolutePath), { recursive: true });
    writeFileSync(reportAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  return {
    ok: report.ok,
    mapId,
    resolutionMode: target.resolutionMode,
    warnings: [...target.warnings],
    reportPath: target.reportPath,
    mapStatus,
    report
  };
}

export function createMapIntegrationReport(input) {
  const perMapStatus = [...(input.perMapStatus ?? [])];
  const failedDownstream = [...(input.failedDownstream ?? [])];
  const total = perMapStatus.length;
  const passed = perMapStatus.filter((entry) => entry.ok === true).length;
  const failed = perMapStatus.filter((entry) => entry.ok !== true).length;
  const propagationDuration = Number.isInteger(input.propagationDuration) ? input.propagationDuration : 0;
  const exitCode = perMapStatus.find((entry) => entry.exitCode !== 0)?.exitCode ?? (total > 0 ? 0 : 1);
  const ok = failed === 0;

  return {
    schemaId: 'atm.mapTestReport',
    specVersion: '0.1.0',
    migration: defaultMapIntegrationReportMigration,
    mapId: input.mapId,
    ok,
    exitCode,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    repositoryRoot: toPortablePath(path.resolve(input.repositoryRoot ?? process.cwd())),
    specPath: input.specPath ?? null,
    testPath: input.testPath ?? null,
    reportPath: input.reportPath ?? null,
    resolutionMode: input.resolutionMode ?? 'canonical',
    warnings: [...(input.warnings ?? [])],
    perMapStatus,
    failedDownstream,
    propagationDuration,
    metrics: createTestReportMetrics({
      total,
      failed,
      latency: propagationDuration
    }),
    artifacts: [input.reportPath, input.specPath, input.testPath]
      .filter(Boolean)
      .map((artifactPath, index) => ({
        artifactPath,
        artifactKind: index === 0 ? 'report' : 'file',
        producedBy: '@ai-atomic-framework/core:map-integration'
      })),
    evidence: [
      {
        evidenceKind: 'validation',
        summary: ok
          ? `Atomic map integration verified ${input.mapId} with ${passed}/${total} map execution(s) passing.`
          : `Atomic map integration detected ${failed} failing map execution(s) while verifying ${input.mapId}.`,
        artifactPaths: [input.reportPath, input.specPath, input.testPath].filter(Boolean)
      }
    ]
  };
}

function resolveLegacyMapTarget(mapId, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const atomsRoot = path.join(repositoryRoot, 'atomic_workbench', 'atoms');
  if (!existsSync(atomsRoot)) {
    return null;
  }

  const ownerDirectories = readdirSync(atomsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const ownerDirectory of ownerDirectories) {
    const legacyWorkbenchPath = path.join(atomsRoot, ownerDirectory.name, 'map');
    const legacySpecPath = path.join(legacyWorkbenchPath, 'map.spec.json');
    const legacyTestPath = path.join(legacyWorkbenchPath, 'map.integration.test.mjs');
    if (!existsSync(legacySpecPath) || !existsSync(legacyTestPath)) {
      continue;
    }

    try {
      const specDocument = JSON.parse(readFileSync(legacySpecPath, 'utf8'));
      if (String(specDocument?.mapId || '').trim() !== mapId) {
        continue;
      }
      return {
        workbenchPath: toPortablePath(path.relative(repositoryRoot, legacyWorkbenchPath)),
        specPath: toPortablePath(path.relative(repositoryRoot, legacySpecPath)),
        testPath: toPortablePath(path.relative(repositoryRoot, legacyTestPath))
      };
    } catch {
      continue;
    }
  }

  return null;
}

function createMapRunnerError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'MapIntegrationRunnerError';
  error.code = code;
  error.details = details;
  return error;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toPortablePath(value) {
  return String(value || '').replace(/\\/g, '/');
}