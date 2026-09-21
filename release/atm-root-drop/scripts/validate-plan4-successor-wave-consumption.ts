#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mapPath = path.join(root, 'docs/reports/plan4-successor-wave-objective-map.json');
const expectedObjectiveIds = Array.from({ length: 17 }, (_, index) => `OBJ-${String(index + 1).padStart(2, '0')}`);

function parseArgs(argv: string[]) {
  const options = { json: false, input: mapPath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--input') {
      options.input = path.resolve(root, String(argv[++index] ?? ''));
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-plan4-successor-wave-consumption.ts [--input <json>] [--json]');
      process.exit(0);
    }
  }
  return options;
}

function readJson(relativePath: string) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) throw new Error(`missing source report: ${relativePath}`);
  return JSON.parse(readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, ''));
}

function sha256File(relativePath: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path.join(root, relativePath))).digest('hex')}`;
}

function assertDigestBindings(report: any, findings: string[]) {
  const sourceReports = Array.isArray(report?.sourceReports) ? report.sourceReports : [];
  if (sourceReports.length !== 5) findings.push(`source report count mismatch: expected 5, observed ${sourceReports.length}`);
  for (const source of sourceReports) {
    const sourcePath = String(source.path ?? '');
    if (!sourcePath) {
      findings.push('source report path missing');
      continue;
    }
    if (!existsSync(path.join(root, sourcePath))) {
      findings.push(`source report missing: ${sourcePath}`);
      continue;
    }
    const observedDigest = sha256File(sourcePath);
    if (source.digest !== observedDigest) findings.push(`source digest mismatch: ${sourcePath}`);
  }
}

function assertObjectiveMap(report: any, findings: string[]) {
  if (report.schemaId !== 'atm.plan4SuccessorWaveObjectiveMap.v1') findings.push('schemaId mismatch');
  if (report.status !== 'successor-evidence-mapped') findings.push('status must be successor-evidence-mapped');
  if (report.totals?.foundationAnchors !== 17) findings.push('foundationAnchors must be 17');
  if (report.totals?.mappedAnchors !== 17) findings.push('mappedAnchors must be 17');
  if (report.totals?.unmappedAnchors !== 0) findings.push('unmappedAnchors must be 0');
  if (report.totals?.sourceReports !== 5) findings.push('sourceReports total must be 5');
  const mappings = Array.isArray(report.objectiveMappings) ? report.objectiveMappings : [];
  const ids = mappings.map((entry: any) => String(entry.objectiveId ?? '')).sort();
  if (JSON.stringify(ids) !== JSON.stringify(expectedObjectiveIds)) findings.push('objective id set mismatch');
  for (const entry of mappings) {
    if (entry.status !== 'successor-evidence-present') findings.push(`mapping not evidence-present: ${entry.objectiveId}`);
    if (!Array.isArray(entry.evidenceRefs) || entry.evidenceRefs.length === 0) findings.push(`evidenceRefs missing: ${entry.objectiveId}`);
  }
}

function assertSourceContracts(findings: string[]) {
  const foundation = readJson('docs/reports/plan-4-foundation-replay.json');
  const shadow = readJson('docs/reports/plan4-real-shadow-comparison.json');
  const adapter = readJson('docs/reports/plan4-six-editor-adapter-parity.json');
  const hostile = readJson('docs/reports/plan4-hostile-dogfood-saturation.json');
  const backlog = readJson('docs/reports/plan-3x-4x-backlog-disposition-census.json');

  if (foundation.schemaId !== 'atm.plan4FoundationReplay.v1') findings.push('foundation schema mismatch');
  if (foundation.plan4ObjectiveDenominator?.expected !== 17 || foundation.plan4ObjectiveDenominator?.observed !== 17) {
    findings.push('foundation denominator mismatch');
  }
  if (!Array.isArray(foundation.objectiveAnchors) || foundation.objectiveAnchors.length !== 17) findings.push('foundation anchor count mismatch');

  if (shadow.schemaId !== 'atm.shadowComparisonRun.v1') findings.push('shadow comparison schema mismatch');
  if (!Array.isArray(shadow.expected?.escapedDefects) || shadow.expected.escapedDefects.length !== 0) findings.push('shadow escapedDefects must be empty');
  if (!Array.isArray(shadow.negativeControls) || shadow.negativeControls.length === 0) findings.push('shadow negative controls missing');
  if (!shadow.nonClaims?.includes('shadow-comparison-does-not-replace-full-release-validation')) {
    findings.push('shadow nonClaim missing');
  }

  if (adapter.schemaId !== 'atm.plan4SixEditorAdapterParity.v1') findings.push('adapter parity schema mismatch');
  if (!Array.isArray(adapter.adapters) || adapter.adapters.length !== 6) findings.push('adapter count mismatch');
  for (const entry of adapter.adapters ?? []) {
    if (entry.installExitCode !== 0 || entry.verifyExitCode !== 0 || entry.frozenRunnerSmoke !== true) {
      findings.push(`adapter parity not green: ${entry.editor}`);
    }
  }

  if (hostile.schemaId !== 'atm.hostileDogfoodSaturationReport.v1') findings.push('hostile dogfood schema mismatch');
  if (!Array.isArray(hostile.hostileBranches) || hostile.hostileBranches.length !== 4) findings.push('hostile branch count mismatch');
  for (const branch of hostile.hostileBranches ?? []) {
    if (branch.overrideLeaseUsed !== false || branch.rollbackPreserved !== true || branch.canonicalWorktreeIntact !== true) {
      findings.push(`hostile branch invariant failed: ${branch.condition}`);
    }
  }
  if (hostile.stoppingRule?.maximumUnknownFamilies !== 0) findings.push('hostile maximumUnknownFamilies must be 0');

  if (backlog.schemaId !== 'atm.backlogCensus.v1') findings.push('backlog census schema mismatch');
  if (backlog.valid !== backlog.total) findings.push('backlog valid total mismatch');
  if (backlog.counts?.unclassified !== 0) findings.push('backlog unclassified rows must be 0');
  if (Array.isArray(backlog.openLikeIds) && backlog.openLikeIds.length !== 0) findings.push('backlog openLikeIds must be empty');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.input)) throw new Error(`Plan 4 successor-wave map missing: ${path.relative(root, options.input)}`);
  const report = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const findings: string[] = [];

  assertObjectiveMap(report, findings);
  assertDigestBindings(report, findings);
  assertSourceContracts(findings);

  const diagnostics = [
    'successor-map-17-of-17',
    'source-report-digests-current',
    'shadow-comparison-fail-closed',
    'six-editor-parity-current',
    'hostile-dogfood-saturated',
    'backlog-census-machine-readable'
  ];
  const output = {
    schemaId: 'atm.plan4SuccessorWaveConsumptionValidation.v1',
    ok: findings.length === 0,
    verdict: findings.length === 0 ? 'plan4-successor-wave-consumed' : 'not-consumed',
    objectiveCount: 17,
    diagnostics,
    findings
  };
  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else if (output.ok) {
    console.log(`[validate-plan4-successor-wave-consumption] ok objectives=${output.objectiveCount} diagnostics=${diagnostics.length}`);
  } else {
    console.error(`[validate-plan4-successor-wave-consumption] failed: ${findings.join('; ')}`);
  }
  process.exit(output.ok ? 0 : 1);
}

main();
