import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/machine-readable-blocker.json');

function parseArgs(argv: string[]) {
  const options = { input: defaultFixturePath, json: false };
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
      console.log('Usage: node --strip-types scripts/validate-plan32-machine-readable-blocker.ts [--input <json>] [--json]');
      process.exit(0);
    }
    throw new Error(`unsupported argument: ${arg}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const fixture = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const findings: string[] = [];
  const blockers = Array.isArray(fixture.blockers) ? fixture.blockers : [];
  const blocker = blockers[0] ?? {};

  if (fixture.schemaId !== 'atm.plan3MachineReadableBlockerFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (fixture.objectiveId !== 'P32-OBJ-26') findings.push('objectiveId mismatch');
  if (fixture.status !== 'not-complete') findings.push('machine-readable blocker fixture must remain not-complete');
  if (blockers.length !== 1) findings.push('fixture must contain exactly one blocker');
  if (typeof blocker.code !== 'string' || blocker.code.length === 0) findings.push('blocker code missing');
  if (typeof blocker.message !== 'string' || blocker.message.length === 0) findings.push('blocker message missing');
  if (typeof blocker.nextSafeCommand !== 'string' || !blocker.nextSafeCommand.includes('validate-atm-3-final-closure')) findings.push('nextSafeCommand missing or not focused');
  if (blocker.terminal !== false) findings.push('blocker must explicitly be non-terminal');
  if (fixture.expectedVerdict !== 'machine-readable-nonterminal-blocker') findings.push('expectedVerdict mismatch');
  for (const diagnostic of ['blocker-code-present', 'next-safe-command-present', 'terminal-false']) {
    if (!fixture.diagnostics?.includes(diagnostic)) findings.push(`missing diagnostic: ${diagnostic}`);
  }

  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan32MachineReadableBlockerValidation.v1',
    ok,
    findings,
    verdict: fixture.expectedVerdict,
    status: fixture.status,
    diagnostics: fixture.diagnostics ?? []
  };
  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan32-machine-readable-blocker] ok verdict=${output.verdict} diagnostics=${output.diagnostics.join(',')}`);
  else console.error(`[validate-plan32-machine-readable-blocker] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
