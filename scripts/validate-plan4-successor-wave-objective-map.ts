#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'docs/reports/plan4-successor-wave-objective-map.json');
const expectedAnchorCount = 17;

function parseArgs(argv: string[]) {
  const options = { json: false, input: reportPath };
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
      console.log('Usage: node --strip-types scripts/validate-plan4-successor-wave-objective-map.ts [--input <json>] [--json]');
      process.exit(0);
    }
  }
  return options;
}

function readJson(relativePath: string) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) throw new Error(`missing file: ${relativePath}`);
  return JSON.parse(readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, ''));
}

function sha256File(relativePath: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path.join(root, relativePath))).digest('hex')}`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.input)) throw new Error(`Plan 4 successor-wave map missing: ${path.relative(root, options.input)}`);
  const report = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const findings: string[] = [];

  const foundation = readJson('docs/reports/plan-4-foundation-replay.json');
  const shadow = readJson('docs/reports/plan4-real-shadow-comparison.json');
  const adapter = readJson('docs/reports/plan4-six-editor-adapter-parity.json');
  const hostile = readJson('docs/reports/plan4-hostile-dogfood-saturation.json');
  const backlog = readJson('docs/reports/plan-3x-4x-backlog-disposition-census.json');

  if (report.schemaId !== 'atm.plan4SuccessorWaveObjectiveMap.v1') findings.push('schemaId mismatch');
  if (report.status !== 'successor-evidence-mapped') findings.push('status must be successor-evidence-mapped');
  if (report.nonClaim !== 'This map proves successor-wave evidence coverage for Plan 4 anchors; it does not complete Plan 3.x objective rows.') {
    findings.push('nonClaim missing or weakened');
  }
  if (!Array.isArray(foundation.objectiveAnchors) || foundation.objectiveAnchors.length !== expectedAnchorCount) {
    findings.push(`foundation anchor count mismatch: expected ${expectedAnchorCount}`);
  }
  if (!foundation.objectiveAnchors.every((row: any) => row.status === 'not-complete')) {
    findings.push('foundation replay must remain fail-closed; successor mapping is a separate layer');
  }
  if (shadow.schemaId !== 'atm.shadowComparisonRun.v1' || shadow.expected?.escapedDefects?.length !== 0) {
    findings.push('shadow comparison is not a clean successor evidence source');
  }
  if (adapter.schemaId !== 'atm.plan4SixEditorAdapterParity.v1' || !adapter.adapters?.every((entry: any) => entry.verifyExitCode === 0 && entry.frozenRunnerSmoke === true)) {
    findings.push('adapter parity is not a clean successor evidence source');
  }
  if (hostile.schemaId !== 'atm.hostileDogfoodSaturationReport.v1' || hostile.stoppingRule?.maximumUnknownFamilies !== 0) {
    findings.push('hostile dogfood saturation is not a clean successor evidence source');
  }
  if (backlog.schemaId !== 'atm.backlogCensus.v1' || backlog.ok !== true || backlog.openLikeIds?.length !== 0) {
    findings.push('backlog census is not a clean successor evidence source');
  }
  for (const source of report.sourceReports ?? []) {
    const sourcePath = String(source.path ?? '');
    if (!sourcePath) {
      findings.push('source path missing');
      continue;
    }
    if (source.digest !== sha256File(sourcePath)) findings.push(`source digest mismatch: ${sourcePath}`);
  }

  const mappings = Array.isArray(report.objectiveMappings) ? report.objectiveMappings : [];
  const foundationIds = new Set(foundation.objectiveAnchors.map((row: any) => String(row.objectiveId)));
  const mappedIds = new Set<string>();
  for (const mapping of mappings) {
    const objectiveId = String(mapping.objectiveId ?? '');
    if (!foundationIds.has(objectiveId)) findings.push(`mapping references unknown objective: ${objectiveId}`);
    if (mappedIds.has(objectiveId)) findings.push(`duplicate mapping: ${objectiveId}`);
    mappedIds.add(objectiveId);
    if (mapping.status !== 'successor-evidence-present') findings.push(`mapping not successor-evidence-present: ${objectiveId}`);
    if (!Array.isArray(mapping.evidenceRefs) || mapping.evidenceRefs.length === 0) findings.push(`mapping lacks evidence: ${objectiveId}`);
  }
  if (mappedIds.size !== expectedAnchorCount) findings.push(`mapped objective count mismatch: expected ${expectedAnchorCount}, observed ${mappedIds.size}`);
  if (report.totals?.mappedAnchors !== expectedAnchorCount) findings.push('totals.mappedAnchors mismatch');
  if (report.totals?.unmappedAnchors !== 0) findings.push('totals.unmappedAnchors must be 0');

  const ok = findings.length === 0;
  const output = {
    ok,
    findings,
    mappedAnchors: mappedIds.size,
    evidenceSources: Array.isArray(report.sourceReports) ? report.sourceReports.length : 0
  };
  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else if (ok) {
    console.log(`[validate-plan4-successor-wave-objective-map] ok mappedAnchors=${mappedIds.size}`);
  } else {
    console.error(`[validate-plan4-successor-wave-objective-map] failed: ${findings.join('; ')}`);
  }
  process.exit(ok ? 0 : 1);
}

main();
