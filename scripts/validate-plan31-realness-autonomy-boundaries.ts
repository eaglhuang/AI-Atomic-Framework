#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/plan31-realness-autonomy-boundaries.json');

function parseArgs(argv: string[]) {
  const options = { json: false, input: defaultFixturePath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-plan31-realness-autonomy-boundaries.ts [--input <fixture.json>] [--json]');
      process.exit(0);
    }
  }
  return options;
}

function row(rows: any[], objectiveId: string): any {
  return rows.find((entry) => entry?.objectiveId === objectiveId) ?? {};
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.input)) throw new Error(`fixture missing: ${path.relative(root, options.input)}`);
  const fixture = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const rows = Array.isArray(fixture.rows) ? fixture.rows : [];
  const findings: string[] = [];

  if (fixture.schemaId !== 'atm.plan31RealnessAutonomyBoundariesFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (rows.length !== 3) findings.push(`expected 3 realness/autonomy rows, observed ${rows.length}`);

  const missing = row(rows, 'P31-OBJ-01');
  if (missing.commandBacked !== true || missing.exactMissingClass !== true || missing.historicalOnly !== false) {
    findings.push('P31-OBJ-01 missing-class evidence must be exact and command-backed');
  }

  const realness = row(rows, 'P31-OBJ-05');
  if (realness.staleHistoricalOnlyRejected !== true || realness.currentReceiptRequired !== true || realness.proseSubstitutionAllowed !== false) {
    findings.push('P31-OBJ-05 realness rule must reject stale/prose-only evidence');
  }

  const autonomy = row(rows, 'P31-OBJ-22');
  if (autonomy.zeroManualCommandReplay !== true || autonomy.emergencyApprovalCountsAsAutonomy !== false || autonomy.approvalHistorySeparated !== true) {
    findings.push('P31-OBJ-22 autonomy must stay separated from emergency approval history');
  }

  if (fixture.expectedVerdict !== 'plan31-realness-autonomy-boundaries-proven') findings.push('expected verdict mismatch');

  const diagnostics = [
    'missing-class-command-backed',
    'stale-history-rejected',
    'emergency-not-autonomous-replay'
  ];
  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan31RealnessAutonomyBoundariesValidation.v1',
    ok,
    findings,
    verdict: ok ? 'plan31-realness-autonomy-boundaries-proven' : 'plan31-realness-autonomy-boundaries-not-proven',
    rowsCovered: rows.map((entry: any) => String(entry.objectiveId)),
    diagnostics
  };

  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan31-realness-autonomy-boundaries] ok rows=${output.rowsCovered.length} diagnostics=${diagnostics.join(',')}`);
  else console.error(`[validate-plan31-realness-autonomy-boundaries] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
