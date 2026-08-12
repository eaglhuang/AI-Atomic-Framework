#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'docs/reports/plan-3x-current-row-proof-map.json');
const expectedPlanRows = new Map([
  ['3.0', 17],
  ['3.1', 23],
  ['3.2', 29]
]);
const familyIds = [
  'fresh-command-replay-needed',
  'governed-state-replay-needed',
  'runner-release-parity-needed',
  'negative-control-only'
];

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
      console.log('Usage: node --strip-types scripts/validate-plan3x-current-row-proof-map.ts [--input <json>] [--json]');
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

function flattenSourceRows(report: any) {
  const rowRefs: string[] = [];
  for (const source of report.sourceReports ?? []) {
    const sourcePath = String(source.path ?? '');
    const sourceReport = readJson(sourcePath);
    if (source.digest !== sha256File(sourcePath)) throw new Error(`source digest mismatch: ${sourcePath}`);
    const expectedRows = expectedPlanRows.get(String(source.planId));
    if (expectedRows === undefined) throw new Error(`unexpected planId: ${source.planId}`);
    if (source.expectedRows !== expectedRows) throw new Error(`expectedRows mismatch for plan ${source.planId}`);
    if (sourceReport.planId !== source.planId) throw new Error(`source planId mismatch: ${sourcePath}`);
    if (sourceReport.denominator !== expectedRows) throw new Error(`denominator mismatch: ${sourcePath}`);
    if (sourceReport.verdict !== 'not-complete') throw new Error(`source verdict must remain not-complete: ${sourcePath}`);
    if (sourceReport.statusCounts?.verified !== 0) throw new Error(`source verified rows must remain zero in this triage layer: ${sourcePath}`);
    if (sourceReport.statusCounts?.['not-complete'] !== expectedRows) throw new Error(`source not-complete rows mismatch: ${sourcePath}`);
    for (const row of sourceReport.rows ?? []) rowRefs.push(String(row.objectiveId));
  }
  return rowRefs;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.input)) throw new Error(`Plan 3.x current-row proof map missing: ${path.relative(root, options.input)}`);
  const report = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const findings: string[] = [];

  if (report.schemaId !== 'atm.plan3xCurrentRowProofMap.v1') findings.push('schemaId mismatch');
  if (report.status !== 'current-row-proof-triaged') findings.push('status must be current-row-proof-triaged');
  if (report.nonClaim !== 'This map classifies every Plan 3.x objective row into the next proof family; it does not certify any Plan 3.x row complete.') {
    findings.push('nonClaim missing or weakened');
  }

  let sourceRows: string[] = [];
  try {
    sourceRows = flattenSourceRows(report);
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
  }
  const sourceSet = new Set(sourceRows);
  if (sourceRows.length !== 69) findings.push(`source row count mismatch: expected 69, observed ${sourceRows.length}`);
  if (sourceSet.size !== sourceRows.length) findings.push('duplicate source objective ids');

  const mappedRows: string[] = [];
  const familyCountById = new Map<string, number>();
  for (const family of report.proofFamilies ?? []) {
    const id = String(family.id ?? '');
    if (!familyIds.includes(id)) findings.push(`unknown proof family: ${id}`);
    if (family.status !== 'not-complete') findings.push(`family status must remain not-complete: ${id}`);
    const refs = Array.isArray(family.rowRefs) ? family.rowRefs.map(String) : [];
    if (family.rowCount !== refs.length) findings.push(`rowCount mismatch for family ${id}`);
    familyCountById.set(id, refs.length);
    mappedRows.push(...refs);
  }
  for (const id of familyIds) {
    if (!familyCountById.has(id)) findings.push(`missing proof family: ${id}`);
  }
  const mappedSet = new Set(mappedRows);
  if (mappedRows.length !== 69) findings.push(`mapped row count mismatch: expected 69, observed ${mappedRows.length}`);
  if (mappedSet.size !== mappedRows.length) findings.push('duplicate mapped objective ids');
  for (const rowRef of mappedRows) {
    if (!sourceSet.has(rowRef)) findings.push(`mapped row not present in source replay: ${rowRef}`);
  }
  for (const rowRef of sourceRows) {
    if (!mappedSet.has(rowRef)) findings.push(`source row missing from proof map: ${rowRef}`);
  }

  if (report.totals?.plans !== 3) findings.push('totals.plans mismatch');
  if (report.totals?.objectiveRows !== 69) findings.push('totals.objectiveRows mismatch');
  if (report.totals?.sourceRowsNotComplete !== 69) findings.push('totals.sourceRowsNotComplete mismatch');
  if (report.totals?.rowsMappedToProofFamily !== 69) findings.push('totals.rowsMappedToProofFamily mismatch');
  if (report.totals?.rowsCertifiedCompleteByThisMap !== 0) findings.push('this map must not certify rows complete');
  if (report.totals?.proofFamilies !== familyIds.length) findings.push('totals.proofFamilies mismatch');

  const summaryTotal = (report.planSummaries ?? []).reduce((total: number, plan: any) => total + Number(plan.rows ?? 0), 0);
  if (summaryTotal !== 69) findings.push('plan summary row total mismatch');
  for (const plan of report.planSummaries ?? []) {
    const expectedRows = expectedPlanRows.get(String(plan.planId));
    if (expectedRows === undefined) findings.push(`unexpected plan summary: ${plan.planId}`);
    if (plan.rows !== expectedRows) findings.push(`plan summary rows mismatch: ${plan.planId}`);
    if (plan.notCompleteRows !== expectedRows) findings.push(`plan summary notCompleteRows mismatch: ${plan.planId}`);
  }

  const orderedFamilies = (report.nextExecutionOrder ?? []).map((entry: any) => String(entry.id));
  if (orderedFamilies.join('|') !== familyIds.join('|')) findings.push('nextExecutionOrder must list all proof families in canonical order');

  const ok = findings.length === 0;
  const output = {
    ok,
    findings,
    mappedRows: mappedSet.size,
    proofFamilies: familyCountById.size
  };
  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else if (ok) {
    console.log(`[validate-plan3x-current-row-proof-map] ok mappedRows=${mappedSet.size}`);
  } else {
    console.error(`[validate-plan3x-current-row-proof-map] failed: ${findings.join('; ')}`);
  }
  process.exit(ok ? 0 : 1);
}

main();
