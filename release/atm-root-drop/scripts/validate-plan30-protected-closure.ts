#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultInput = path.join(root, 'tests/fixtures/plan3-fake-green/current-protected-closure.json');

function parseArgs(argv: string[]) {
  const options = { input: defaultInput, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
    else if (arg === '--json') options.json = true;
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const findings: string[] = [];
  if (!existsSync(options.input)) throw new Error(`protected closure fixture missing: ${path.relative(root, options.input)}`);
  const fixture = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));

  if (fixture.schemaId !== 'atm.plan3FakeGreenClosureFixture.v1') findings.push('schemaId mismatch');
  if (fixture.candidateCount !== 2) findings.push('candidateCount must be 2');
  if (fixture.ticketState !== 'not-required') findings.push('ticketState must remain not-required for this protected negative fixture');
  if (!Array.isArray(fixture.requiredIntersection) || !fixture.requiredIntersection.includes('docs/governance/atm-3-replay-evidence.md')) {
    findings.push('requiredIntersection must include docs/governance/atm-3-replay-evidence.md');
  }
  if (fixture.cellCount !== 420) findings.push('cellCount must be 420');
  if (fixture.commandBackedCount !== fixture.cellCount) findings.push('every protected closure cell must be command-backed');
  if (fixture.sameFilePathOnlySerialization !== true) findings.push('same-file path-only serialization must be true');
  if (fixture.callSiteParityOk !== true) findings.push('call-site parity must be true');
  if (fixture.sourceFrozenParityOk !== false) findings.push('source/frozen parity fault must fail closed');

  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan30ProtectedClosureValidation.v1',
    ok,
    findings,
    failClosed: fixture.sourceFrozenParityOk === false,
    commandBackedCount: fixture.commandBackedCount,
    cellCount: fixture.cellCount
  };

  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan30-protected-closure] ok cells=${fixture.cellCount} failClosed=true`);
  else console.error(`[validate-plan30-protected-closure] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
