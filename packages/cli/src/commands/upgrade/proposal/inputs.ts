import path from 'node:path';
import { existsSync } from 'node:fs';
import { CliError, readJsonFile } from '../../shared.ts';
import { collectJsonFiles } from '../path-helpers.ts';

export function loadExplicitInputDocuments(cwd: string, inputPaths: string[]) {
  return inputPaths.map((inputPath: string) => {
    const resolvedPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
    const rawDocument = readJsonFile(resolvedPath, 'ATM_UPGRADE_INPUT_NOT_FOUND');
    const document = normalizeUpgradeInputDocument(rawDocument);
    return {
      path: path.relative(cwd, resolvedPath).replace(/\\/g, '/'),
      document: (document ?? {}) as Record<string, unknown>
    };
  });
}

export function discoverInputDocuments(cwd: string) {
  const reportsRoot = path.join(cwd, '.atm', 'history', 'reports');
  if (!existsSync(reportsRoot)) {
    throw new CliError('ATM_UPGRADE_INPUTS_NOT_FOUND', 'Upgrade requires input reports. Provide --input paths or stage reports under .atm/history/reports.', {
      exitCode: 2,
      details: { reportsRoot }
    });
  }

  const discoveredFiles = collectJsonFiles(reportsRoot).sort((left, right) => left.localeCompare(right));
  const discoveredDocuments = discoveredFiles.map((filePath) => ({
    path: path.relative(cwd, filePath).replace(/\\/g, '/'),
    document: (readJsonFile(filePath, 'ATM_UPGRADE_INPUT_NOT_FOUND') ?? {}) as Record<string, unknown> & { schemaId: string }
  }));

  const inputDocuments = [];
  for (const kind of ['hash-diff', 'execution-evidence', 'non-regression', 'quality-comparison', 'registry-candidate']) {
    const match = discoveredDocuments.find((entry) => inferInputKind(entry.document.schemaId) === kind);
    if (match) {
      inputDocuments.push(match);
    }
  }

  if (inputDocuments.length === 0) {
    throw new CliError('ATM_UPGRADE_INPUTS_NOT_FOUND', 'Upgrade could not discover any recognized input reports under .atm/history/reports.', {
      exitCode: 2,
      details: { reportsRoot }
    });
  }

  return inputDocuments;
}

function normalizeUpgradeInputDocument(document: Record<string, unknown> | null | undefined) {
  if (!document) return document;
  const docObj = document as { expectedReport?: unknown; evidence?: { propagationReport?: unknown; report?: unknown; decisionLog?: unknown }; schemaId?: string };
  if (docObj.expectedReport && !docObj.schemaId) {
    return docObj.expectedReport;
  }
  if (docObj.evidence?.propagationReport && !docObj.schemaId) {
    return docObj.evidence.propagationReport;
  }
  if (docObj.evidence?.report && !docObj.schemaId) {
    return docObj.evidence.report;
  }
  if (docObj.evidence?.decisionLog && !docObj.schemaId) {
    return docObj.evidence.decisionLog;
  }
  return document;
}

export function inferInputKind(schemaId: string | null | undefined) {
  switch (schemaId) {
    case 'atm.hashDiffReport':
      return 'hash-diff';
    case 'atm.executionEvidence':
      return 'execution-evidence';
    case 'atm.police.nonRegressionReport':
      return 'non-regression';
    case 'atm.police.qualityComparisonReport':
      return 'quality-comparison';
    case 'atm.police.registryCandidateReport':
      return 'registry-candidate';
    case 'atm.mapEquivalenceReport':
      return 'map-equivalence';
    case 'atm.polymorphImpactReport':
      return 'polymorph-impact';
    case 'atm.rollbackProof':
    case 'atm.evidence.rollbackProof':
      return 'rollback-proof';
    case 'atm.evidencePatternDetectorReport':
      return 'evidence-pattern-report';
    default:
      return null;
  }
}
