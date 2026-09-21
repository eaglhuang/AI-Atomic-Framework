import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFourPlanObjectiveVerdict,
  type FourPlanObjectiveRow
} from '../packages/core/src/evidence/plan-closeout-dashboard.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultReplayPath = path.join(root, 'docs/reports/plan-3-2-objective-replay.json');

function parseArgs(argv: string[]) {
  const options = { input: defaultReplayPath, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      options.input = path.resolve(argv[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-plan32-dashboard-consumption.ts [--input <json>] [--json]');
      process.exit(0);
    }
    throw new Error(`unsupported argument: ${arg}`);
  }
  return options;
}

function toDashboardRows(replay: any): FourPlanObjectiveRow[] {
  return (replay.rows ?? []).map((row: any) => ({
    planId: 'Plan 3.2' as const,
    objectiveId: String(row.objectiveId).replace(/^P32-/, ''),
    status: row.status,
    evidenceRefs: [
      ...row.sourceAnchors ?? [],
      ...row.evidenceTuples?.map((entry: any) => entry.source) ?? []
    ]
  }));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const replay = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const verdict = buildFourPlanObjectiveVerdict({
    generatedAt: new Date(0).toISOString(),
    rows: toDashboardRows(replay)
  });
  const findings: string[] = [];

  if (replay.schemaId !== 'atm.planObjectiveReplay.v1') findings.push('source replay schemaId mismatch');
  if (replay.planId !== '3.2') findings.push('source replay planId mismatch');
  if (verdict.schemaId !== 'atm.fourPlanObjectiveVerdict.v1') findings.push('dashboard verdict schemaId mismatch');
  if (verdict.observedDenominators['Plan 3.2'] !== replay.denominator) findings.push('Plan 3.2 denominator was not consumed');
  if (verdict.statusCounts.verified !== replay.statusCounts.verified) findings.push('verified status count was not consumed');
  if (verdict.statusCounts['not-complete'] !== replay.statusCounts['not-complete']) findings.push('not-complete status count was not consumed');
  if (verdict.status !== 'not-ready') findings.push('partial Plan 3.2 dashboard consumption must not mark the four-plan dashboard ready');
  for (const missingPlan of ['Plan 3.0', 'Plan 3.1', 'Plan 4.0']) {
    if (!verdict.findings.some((entry) => entry.includes(`${missingPlan} denominator expected`))) findings.push(`missing denominator finding for ${missingPlan}`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(verdict.sortedRowDigest)) findings.push('dashboard verdict row digest missing');

  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan32DashboardConsumptionValidation.v1',
    ok,
    findings,
    consumedPlanId: replay.planId,
    observedRows: verdict.observedDenominators['Plan 3.2'],
    verified: verdict.statusCounts.verified,
    notComplete: verdict.statusCounts['not-complete'],
    dashboardStatus: verdict.status,
    wholeDashboardReady: verdict.status === 'ready',
    sortedRowDigest: verdict.sortedRowDigest
  };
  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan32-dashboard-consumption] ok rows=${output.observedRows} verified=${output.verified} notComplete=${output.notComplete} digest=${output.sortedRowDigest}`);
  else console.error(`[validate-plan32-dashboard-consumption] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
