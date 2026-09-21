#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/plan32-foundation-runner-boundaries.json');

function parseArgs(argv: string[]) {
  const options = { json: false, input: defaultFixturePath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
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

  if (fixture.schemaId !== 'atm.plan32FoundationRunnerBoundariesFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (rows.length !== 6) findings.push(`expected 6 foundation/runner rows, observed ${rows.length}`);
  if (row(rows, 'P32-OBJ-03').freshnessBindingExplicit !== true || row(rows, 'P32-OBJ-03').staleRunnerMayGreen !== false) findings.push('P32-OBJ-03 freshness binding must reject stale runner green');
  if (row(rows, 'P32-OBJ-07').runnerSagaDigestPresent !== true || row(rows, 'P32-OBJ-07').receiptTextMaySubstituteDigest !== false) findings.push('P32-OBJ-07 runner saga must be digest-backed');
  if (row(rows, 'P32-OBJ-10').sealedApplyRecoverable !== true || row(rows, 'P32-OBJ-10').partialApplyMayGreen !== false) findings.push('P32-OBJ-10 sealed apply must be recoverable and fail closed on partial apply');
  if (row(rows, 'P32-OBJ-14').composeAttributionExplicit !== true || row(rows, 'P32-OBJ-14').anonymousComposeAllowed !== false) findings.push('P32-OBJ-14 compose attribution must be explicit');
  if (row(rows, 'P32-OBJ-15').deferralOrderDeterministic !== true || row(rows, 'P32-OBJ-15').queueOrderCallerAsserted !== false) findings.push('P32-OBJ-15 deferral order must be deterministic and not caller asserted');
  if (row(rows, 'P32-OBJ-21').genericPlan4FixtureBoundaryVisible !== true || row(rows, 'P32-OBJ-21').hostSpecificFixtureMayGreen !== false) findings.push('P32-OBJ-21 Plan 4 fixture boundary must be generic');
  if (fixture.expectedVerdict !== 'plan32-foundation-runner-boundaries-proven') findings.push('expected verdict mismatch');

  const diagnostics = [
    'freshness-binding-explicit',
    'runner-saga-digest',
    'sealed-apply-recoverable',
    'compose-attribution-explicit',
    'deferral-order-deterministic',
    'generic-plan4-fixture-boundary'
  ];
  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan32FoundationRunnerBoundariesValidation.v1',
    ok,
    findings,
    verdict: ok ? 'plan32-foundation-runner-boundaries-proven' : 'plan32-foundation-runner-boundaries-not-proven',
    rowsCovered: rows.map((entry: any) => String(entry.objectiveId)),
    diagnostics
  };
  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan32-foundation-runner-boundaries] ok rows=${output.rowsCovered.length} diagnostics=${diagnostics.join(',')}`);
  else console.error(`[validate-plan32-foundation-runner-boundaries] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
