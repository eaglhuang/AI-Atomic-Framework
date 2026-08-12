#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/plan30-parity-policy-boundaries.json');

function parseArgs(argv: string[]) {
  const options = { json: false, input: defaultFixturePath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-plan30-parity-policy-boundaries.ts [--input <fixture.json>] [--json]');
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

  if (fixture.schemaId !== 'atm.plan30ParityPolicyBoundariesFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (rows.length !== 3) findings.push(`expected 3 parity/policy rows, observed ${rows.length}`);

  const sourceFrozen = row(rows, 'P30-OBJ-03');
  if (sourceFrozen.sourceDigestPresent !== true || sourceFrozen.frozenRunnerDigestPresent !== true || sourceFrozen.parityDecisionCallerAsserted !== false) {
    findings.push('P30-OBJ-03 source/frozen parity must be digest-backed and not caller asserted');
  }

  const releaseAdopter = row(rows, 'P30-OBJ-04');
  if (releaseAdopter.releaseDigestPresent !== true || releaseAdopter.adopterDigestPresent !== true || releaseAdopter.observableThroughStableSurface !== true) {
    findings.push('P30-OBJ-04 release/adopter parity must be observable through stable digest surfaces');
  }

  const policy = row(rows, 'P30-OBJ-10');
  if (policy.policyDigestPresent !== true || policy.correctnessDebtAllowed !== false || policy.policyLockBypassesEvidence !== false) {
    findings.push('P30-OBJ-10 locked policy state must not carry correctness debt or bypass evidence');
  }

  if (fixture.expectedVerdict !== 'plan30-parity-policy-boundaries-proven') findings.push('expected verdict mismatch');

  const diagnostics = [
    'source-frozen-parity-digests',
    'release-adopter-parity-observable',
    'locked-policy-no-correctness-debt'
  ];
  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan30ParityPolicyBoundariesValidation.v1',
    ok,
    findings,
    verdict: ok ? 'plan30-parity-policy-boundaries-proven' : 'plan30-parity-policy-boundaries-not-proven',
    rowsCovered: rows.map((entry: any) => String(entry.objectiveId)),
    diagnostics
  };

  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan30-parity-policy-boundaries] ok rows=${output.rowsCovered.length} diagnostics=${diagnostics.join(',')}`);
  else console.error(`[validate-plan30-parity-policy-boundaries] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
