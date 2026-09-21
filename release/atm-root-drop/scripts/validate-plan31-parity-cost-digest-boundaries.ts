#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/plan31-parity-cost-digest-boundaries.json');

function parseArgs(argv: string[]) {
  const options = { json: false, input: defaultFixturePath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-plan31-parity-cost-digest-boundaries.ts [--input <fixture.json>] [--json]');
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

  if (fixture.schemaId !== 'atm.plan31ParityCostDigestBoundariesFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (rows.length !== 4) findings.push(`expected 4 parity/cost/digest rows, observed ${rows.length}`);

  const frozen = row(rows, 'P31-OBJ-08');
  if (frozen.oldDigestPresent !== true || frozen.newDigestPresent !== true || frozen.redGreenReplayable !== true) {
    findings.push('P31-OBJ-08 old/new frozen same-digest evidence must be replayable');
  }

  const cost = row(rows, 'P31-OBJ-15');
  if (cost.correctnessIndependentOfPerformance !== true || cost.costIndependentOfCorrectness !== true || cost.performanceSignalMayGreenCorrectness !== false) {
    findings.push('P31-OBJ-15 correctness, performance, and cost must stay separated');
  }

  const breaker = row(rows, 'P31-OBJ-18');
  if (breaker.parityDigestPresent !== true || breaker.breakerDigestPresent !== true || breaker.digestRequiredForTerminalProof !== true) {
    findings.push('P31-OBJ-18 parity and breaker evidence must carry digests');
  }

  const runnerSync = row(rows, 'P31-OBJ-19');
  if (runnerSync.runnerSyncDigestPresent !== true || runnerSync.visibleToFinalCertificate !== true || runnerSync.receiptTextMaySubstituteDigest !== false) {
    findings.push('P31-OBJ-19 runner-sync digest must be visible to final certificate');
  }

  if (fixture.expectedVerdict !== 'plan31-parity-cost-digest-boundaries-proven') findings.push('expected verdict mismatch');

  const diagnostics = [
    'old-new-frozen-digest-replayable',
    'cost-correctness-separated',
    'parity-breaker-digests',
    'runner-sync-digest-visible'
  ];
  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan31ParityCostDigestBoundariesValidation.v1',
    ok,
    findings,
    verdict: ok ? 'plan31-parity-cost-digest-boundaries-proven' : 'plan31-parity-cost-digest-boundaries-not-proven',
    rowsCovered: rows.map((entry: any) => String(entry.objectiveId)),
    diagnostics
  };

  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan31-parity-cost-digest-boundaries] ok rows=${output.rowsCovered.length} diagnostics=${diagnostics.join(',')}`);
  else console.error(`[validate-plan31-parity-cost-digest-boundaries] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
