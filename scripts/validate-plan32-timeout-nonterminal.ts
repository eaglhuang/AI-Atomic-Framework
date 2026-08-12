import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/timeout-nonterminal.json');

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
      console.log('Usage: node --strip-types scripts/validate-plan32-timeout-nonterminal.ts [--input <json>] [--json]');
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

  if (fixture.schemaId !== 'atm.plan3TimeoutNonterminalFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (fixture.receipt?.timedOut !== true) findings.push('fixture must model a timed-out validator receipt');
  if (fixture.receipt?.status !== 'timeout') findings.push('timed-out receipt must carry timeout status');
  if (fixture.receipt?.exitCode !== null) findings.push('timed-out receipt must not claim a successful exit code');
  if (fixture.expectedVerdict !== 'not-complete') findings.push('timeout expectedVerdict must remain not-complete');
  for (const forbidden of ['verified', 'pass', 'complete']) {
    if (!fixture.forbiddenVerdicts?.includes(forbidden)) findings.push(`missing forbidden verdict: ${forbidden}`);
  }
  for (const diagnostic of ['timeout-is-nonterminal', 'timeout-must-not-green']) {
    if (!fixture.diagnostics?.includes(diagnostic)) findings.push(`missing diagnostic: ${diagnostic}`);
  }

  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan32TimeoutNonterminalValidation.v1',
    ok,
    findings,
    verdict: fixture.expectedVerdict,
    failClosed: true,
    diagnostics: fixture.diagnostics ?? []
  };
  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan32-timeout-nonterminal] ok verdict=${output.verdict} diagnostics=${output.diagnostics.join(',')}`);
  else console.error(`[validate-plan32-timeout-nonterminal] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
