#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/plan30-closure-evidence-boundaries.json');

function parseArgs(argv: string[]) {
  const options = { json: false, input: defaultFixturePath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-plan30-closure-evidence-boundaries.ts [--input <fixture.json>] [--json]');
      process.exit(0);
    }
  }
  return options;
}

function requireRow(rows: any[], objectiveId: string): any {
  return rows.find((entry) => entry?.objectiveId === objectiveId) ?? {};
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.input)) throw new Error(`fixture missing: ${path.relative(root, options.input)}`);
  const fixture = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const findings: string[] = [];
  const rows = Array.isArray(fixture.rows) ? fixture.rows : [];

  if (fixture.schemaId !== 'atm.plan30ClosureEvidenceBoundariesFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (rows.length !== 4) findings.push(`expected 4 boundary rows, observed ${rows.length}`);

  const divergence = requireRow(rows, 'P30-OBJ-01');
  if (divergence.commandBacked !== true || divergence.sealedRawInputs !== true || divergence.callerAsserted !== false) {
    findings.push('P30-OBJ-01 divergence evidence must be command-backed, sealed, and not caller asserted');
  }

  const predicate = requireRow(rows, 'P30-OBJ-09');
  if (predicate.commandBacked !== true || predicate.predicateComputedByVerifier !== true || predicate.callerAsserted !== false) {
    findings.push('P30-OBJ-09 closure predicate must be verifier-computed and not caller asserted');
  }

  const telemetry = requireRow(rows, 'P30-OBJ-11');
  if (telemetry.telemetryAvailable !== true || telemetry.telemetryCountsAsCorrectness !== false || telemetry.requiresIndependentCorrectnessReceipt !== true) {
    findings.push('P30-OBJ-11 telemetry must remain separate from correctness');
  }

  const breaker = requireRow(rows, 'P30-OBJ-14');
  if (breaker.digestEvidencePresent !== true || breaker.resetIsObservable !== true || breaker.digestRequiredForClosure !== true) {
    findings.push('P30-OBJ-14 circuit breaker reset must carry digest evidence');
  }

  if (fixture.expectedVerdict !== 'plan30-closure-boundaries-command-backed') findings.push('expected verdict mismatch');

  const diagnostics = [
    'divergence-command-backed',
    'closure-predicate-not-caller-asserted',
    'telemetry-not-correctness',
    'circuit-breaker-reset-digest'
  ];
  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan30ClosureEvidenceBoundariesValidation.v1',
    ok,
    findings,
    verdict: ok ? 'plan30-closure-boundaries-command-backed' : 'plan30-closure-boundaries-not-proven',
    rowsCovered: rows.map((entry: any) => String(entry.objectiveId)),
    diagnostics
  };

  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan30-closure-evidence-boundaries] ok rows=${output.rowsCovered.length} diagnostics=${diagnostics.join(',')}`);
  else console.error(`[validate-plan30-closure-evidence-boundaries] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
