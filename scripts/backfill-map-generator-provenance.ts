import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAtomicMap } from '../packages/core/src/manager/map-generator.ts';
import { validateRegistryDocument, validateRegistryDocumentFile, writeRegistryArtifacts } from '../packages/core/src/registry/registry.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceId = readArg('--source') ?? 'ATM-MAP-NEUTRALITY-0001';
const dryRun = process.argv.includes('--dry-run');
const writeMode = process.argv.includes('--write') || !dryRun;
const now = new Date().toISOString();

const sourcePaths = resolveLegacySourcePaths(sourceId);
const registryValidation = validateRegistryDocumentFile(path.join(root, 'atomic-registry.json'));
if (!registryValidation.ok) {
  console.error(`[backfill-map-generator-provenance] registry validation failed: ${registryValidation.promptReport?.summary ?? 'unknown error'}`);
  process.exit(1);
}

const legacyMap = readJson(sourcePaths.mapPath);
const legacyReport = readJson(sourcePaths.reportPath);
const ownerVersion = resolveOwnerVersion(registryValidation.document, legacyMap.ownerAtom);
const request = createBackfillRequest(legacyMap, legacyReport, ownerVersion);
const result = generateAtomicMap(request, {
  repositoryRoot: root,
  dryRun,
  now
});

if (!result.ok) {
  console.error(`[backfill-map-generator-provenance] generator failed: ${result.error?.code ?? 'ATM_MAP_BACKFILL_FAILED'} ${result.error?.message ?? ''}`.trim());
  process.exit(1);
}

const payload: any = {
  ok: true,
  sourceMapId: sourceId,
  canonicalMapId: result.mapId,
  dryRun,
  idempotent: result.idempotent === true,
  workbenchPath: result.workbenchPath,
  specPath: result.specPath,
  testPath: result.testPath,
  reportPath: result.reportPath,
  sourcePaths,
  lineageLogPath: result.workbenchPath ? `${result.workbenchPath}/lineage-log.json` : null
};

if (writeMode && !dryRun) {
  const workbenchAbsolutePath = path.join(root, result.workbenchPath);
  mkdirSync(workbenchAbsolutePath, { recursive: true });

  const legacyMapTargetPath = `${result.workbenchPath}/legacy-source.map.json`;
  const legacyReportTargetPath = `${result.workbenchPath}/legacy-source.report.json`;
  const lineageLogPath = `${result.workbenchPath}/lineage-log.json`;
  writeJson(path.join(root, legacyMapTargetPath), {
    archivedFromMapId: sourceId,
    canonicalMapId: result.mapId,
    archivedAt: now,
    sourcePath: sourcePaths.mapPath,
    legacyMap
  });
  writeJson(path.join(root, legacyReportTargetPath), {
    archivedFromMapId: sourceId,
    canonicalMapId: result.mapId,
    archivedAt: now,
    sourcePath: sourcePaths.reportPath,
    legacyReport
  });
  writeJson(path.join(root, lineageLogPath), createLineageLog({
    sourceId,
    canonicalMapId: result.mapId,
    ownerAtom: legacyMap.ownerAtom,
    ownerVersion,
    sourcePaths,
    legacyMap,
    legacyReport,
    generatedAt: now
  }));
  const specAbsolutePath = path.join(root, result.specPath);
  const specDocument = JSON.parse(readFileSync(specAbsolutePath, 'utf8'));
  writeJson(specAbsolutePath, {
    ...specDocument,
    lineageLogRef: lineageLogPath
  });

  const registryPath = path.join(root, 'atomic-registry.json');
  const registryDocument = JSON.parse(readFileSync(registryPath, 'utf8'));
  const updatedRegistry = {
    ...registryDocument,
    generatedAt: now,
    entries: registryDocument.entries.map((entry: any) => {
      if (entry?.mapId !== result.mapId) {
        return entry;
      }
      const evidence = uniqueStrings([
        ...(entry.evidence ?? []).filter((value: any) => value !== 'generator-provenance:generated'),
        'generator-provenance:backfilled',
        result.specPath,
        result.testPath,
        result.reportPath,
        legacyMapTargetPath,
        legacyReportTargetPath,
        lineageLogPath
      ]);
      return {
        ...entry,
        location: {
          specPath: result.specPath,
          codePaths: [],
          testPaths: [result.testPath],
          reportPath: result.reportPath,
          workbenchPath: result.workbenchPath
        },
        evidence,
        lineageLogRef: lineageLogPath
      };
    })
  };

  const registryDocumentValidation = validateRegistryDocument(updatedRegistry);
  if (!registryDocumentValidation.ok) {
    console.error(`[backfill-map-generator-provenance] updated registry invalid: ${registryDocumentValidation.promptReport?.summary ?? 'unknown error'}`);
    process.exit(1);
  }

  writeRegistryArtifacts(updatedRegistry, {
    repositoryRoot: root,
    registryPath: 'atomic-registry.json',
    catalogPath: 'atomic_workbench/registry-catalog.md'
  });

  payload.archivedLegacyMapPath = legacyMapTargetPath;
  payload.archivedLegacyReportPath = legacyReportTargetPath;
  payload.lineageLogPath = lineageLogPath;
}

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

function resolveLegacySourcePaths(sourceId: any) {
  const fixtureRoot = path.join(root, 'tests', 'fixtures', 'map-generator-provenance', sourceId);
  const mapPath = path.join(fixtureRoot, 'legacy-map.json');
  const reportPath = path.join(fixtureRoot, 'legacy-report.json');
  if (!existsSync(mapPath) || !existsSync(reportPath)) {
    throw new Error(`Unknown legacy map source: ${sourceId}`);
  }
  return {
    mapPath: toProjectPath(mapPath),
    reportPath: toProjectPath(reportPath)
  };
}

function resolveOwnerVersion(registryDocument: any, ownerAtom: any) {
  const ownerEntry = (registryDocument.entries ?? []).find((entry: any) => entry?.atomId === ownerAtom);
  return String(ownerEntry?.currentVersion || ownerEntry?.atomVersion || '0.1.0').trim();
}

function createBackfillRequest(legacyMap: any, legacyReport: any, ownerVersion: any) {
  const failedCaseCount = Array.isArray(legacyReport.cases)
    ? legacyReport.cases.filter((entry: any) => entry?.status === 'fail').length
    : 0;
  return {
    mapVersion: '0.1.0',
    members: [
      {
        atomId: String(legacyMap.ownerAtom || '').trim(),
        version: ownerVersion
      }
    ],
    edges: [],
    entrypoints: [String(legacyMap.ownerAtom || '').trim()],
    qualityTargets: {
      legacyMemberCount: Array.isArray(legacyMap.members) ? legacyMap.members.length : 0,
      legacyCaseCount: Array.isArray(legacyReport.cases) ? legacyReport.cases.length : 0,
      legacyFailedCaseCount: failedCaseCount,
      migrationBackfilled: true
    }
  };
}

function createLineageLog(input: any) {
  return {
    schemaId: 'atm.mapLineageLog',
    specVersion: '0.1.0',
    sourceMapId: input.sourceId,
    canonicalMapId: input.canonicalMapId,
    generatedAt: input.generatedAt,
    ownerAtom: input.ownerAtom,
    ownerVersion: input.ownerVersion,
    sourcePaths: input.sourcePaths,
    legacyMapVersion: input.legacyMap.mapVersion,
    legacySchemaVersion: input.legacyMap.schemaVersion,
    legacyMemberIds: Array.isArray(input.legacyMap.members)
      ? input.legacyMap.members.map((member: any) => member.atomId)
      : [],
    legacyCaseNames: Array.isArray(input.legacyReport.cases)
      ? input.legacyReport.cases.map((entry: any) => entry.name)
      : [],
    notes: [
      'Legacy local map preserved as archived lineage evidence.',
      'Canonical backfill collapses the pre-atomized local member graph to the owner atom so the active registry entry stays valid under atm.atomicMap.'
    ]
  };
}

function readArg(name: any) {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function readJson(relativePath: any) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function writeJson(targetPath: any, value: any) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function uniqueStrings(values: any) {
  return [...new Set(values
    .map((value: any) => String(value || '').trim())
    .filter(Boolean))];
}

function toProjectPath(filePath: any) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}
