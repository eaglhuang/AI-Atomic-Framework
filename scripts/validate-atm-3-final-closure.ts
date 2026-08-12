#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface ObjectiveRow {
  readonly objectiveId?: unknown;
  readonly status?: unknown;
  readonly evidenceTuples?: unknown;
  readonly nextSafeCommand?: unknown;
}

function parseArgs(argv: string[]) {
  const options = {
    mode: 'validate',
    input: path.join(root, 'docs/reports/plan-3-0-objective-replay.json'),
    expectPlan: '3.0',
    expectRows: 17,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') options.mode = String(argv[++index] ?? '');
    else if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
    else if (arg === '--plan') options.expectPlan = String(argv[++index] ?? '');
    else if (arg === '--expect-rows') options.expectRows = Number(String(argv[++index] ?? ''));
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-atm-3-final-closure.ts --mode validate [--input <json>] [--plan 3.0] [--expect-rows 17] [--json]');
      process.exit(0);
    }
  }
  return options;
}

function asRows(value: any): ObjectiveRow[] {
  return Array.isArray(value?.rows) ? value.rows : [];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode !== 'validate') throw new Error(`unsupported mode: ${options.mode}`);
  if (!existsSync(options.input)) throw new Error(`closure replay missing: ${path.relative(root, options.input)}`);

  const parsed = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const rows = asRows(parsed);
  const ids = rows.map((row) => String(row.objectiveId ?? '').trim()).filter(Boolean);
  const findings: string[] = [];

  if (parsed.schemaId !== 'atm.planObjectiveReplay.v1') findings.push('schemaId must be atm.planObjectiveReplay.v1');
  if (String(parsed.planId ?? '') !== options.expectPlan) findings.push(`planId must be ${options.expectPlan}`);
  if (rows.length !== options.expectRows) findings.push(`expected ${options.expectRows} objective rows, found ${rows.length}`);
  if (new Set(ids).size !== ids.length) findings.push('objectiveId values must be unique');
  if (ids.length !== rows.length) findings.push('every row must have objectiveId');

  for (const row of rows) {
    const rowId = String(row.objectiveId ?? '<missing>');
    const status = String(row.status ?? '');
    const tuples = Array.isArray(row.evidenceTuples) ? row.evidenceTuples : [];
    if (!['verified', 'not-complete', 'unknown', 'conflicting'].includes(status)) findings.push(`${rowId}: invalid status ${status}`);
    if (tuples.length === 0) findings.push(`${rowId}: evidenceTuples required`);
    if ((status === 'not-complete' || status === 'unknown' || status === 'conflicting') && typeof row.nextSafeCommand !== 'string') {
      findings.push(`${rowId}: non-verified rows require nextSafeCommand`);
    }
    if (status === 'verified' && tuples.some((tuple: any) => String(tuple?.source ?? '').trim() === '')) {
      findings.push(`${rowId}: verified rows require concrete evidence tuple sources`);
    }
  }

  const verified = rows.filter((row) => row.status === 'verified').length;
  const notComplete = rows.filter((row) => row.status === 'not-complete').length;
  if (parsed.verdict === 'complete' && verified !== options.expectRows) findings.push('complete verdict requires every row verified');
  if (parsed.verdict !== 'not-complete') findings.push('Plan 3.0 replay must remain not-complete until every row is verified');

  const result = {
    schemaId: 'atm.planObjectiveReplayValidation.v1',
    ok: findings.length === 0,
    input: path.relative(root, options.input).split(path.sep).join('/'),
    planId: options.expectPlan,
    rowCount: rows.length,
    verified,
    notComplete,
    findings
  };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) console.log(`[validate-atm-3-final-closure] ok plan=${options.expectPlan} rows=${rows.length} verdict=${parsed.verdict}`);
  else console.error(`[validate-atm-3-final-closure] failed: ${findings.join('; ')}`);
  process.exit(result.ok ? 0 : 1);
}

main();
