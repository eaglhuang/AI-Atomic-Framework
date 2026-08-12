#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/plan30-operational-state-safety.json');

function parseArgs(argv: string[]) {
  const options = { json: false, input: defaultFixturePath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-plan30-operational-state-safety.ts [--input <fixture.json>] [--json]');
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

  if (fixture.schemaId !== 'atm.plan30OperationalStateSafetyFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (rows.length !== 3) findings.push(`expected 3 operational rows, observed ${rows.length}`);

  const rollback = row(rows, 'P30-OBJ-05');
  if (rollback.rollbackPathPreserved !== true || rollback.rollbackIsDestructiveByDefault !== false || rollback.requiresExplicitExecution !== true) {
    findings.push('P30-OBJ-05 rollback path must be preserved, non-destructive by default, and explicit to execute');
  }

  const transition = row(rows, 'P30-OBJ-06');
  if (transition.transitionIdempotent !== true || transition.duplicateTransitionRejected !== true || transition.eventDurable !== true) {
    findings.push('P30-OBJ-06 transition evidence must be durable and exactly-once');
  }

  const legacy = row(rows, 'P30-OBJ-17');
  if (legacy.legacyAuthorityActiveUntilFinalCertificate !== true || legacy.retirementRequiresFinalCertificate !== true || legacy.earlyRetirementForbidden !== true) {
    findings.push('P30-OBJ-17 legacy authority must wait for final certificate');
  }

  if (fixture.expectedVerdict !== 'plan30-operational-state-safety-proven') findings.push('expected verdict mismatch');

  const diagnostics = [
    'rollback-path-preserved',
    'exactly-once-transition-durable',
    'legacy-authority-retirement-deferred'
  ];
  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan30OperationalStateSafetyValidation.v1',
    ok,
    findings,
    verdict: ok ? 'plan30-operational-state-safety-proven' : 'plan30-operational-state-safety-not-proven',
    rowsCovered: rows.map((entry: any) => String(entry.objectiveId)),
    diagnostics
  };

  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan30-operational-state-safety] ok rows=${output.rowsCovered.length} diagnostics=${diagnostics.join(',')}`);
  else console.error(`[validate-plan30-operational-state-safety] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
