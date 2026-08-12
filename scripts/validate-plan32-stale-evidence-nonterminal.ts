import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/stale-evidence-nonterminal.json');

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
      console.log('Usage: node --strip-types scripts/validate-plan32-stale-evidence-nonterminal.ts [--input <json>] [--json]');
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

  if (fixture.schemaId !== 'atm.plan3StaleEvidenceNonterminalFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (fixture.evidence?.kind !== 'stale-reference') findings.push('fixture must model stale-reference evidence');
  if (fixture.evidence?.freshCommandReceipt !== null) findings.push('stale fixture must not include a fresh command receipt');
  if (fixture.evidence?.currentDigest !== null) findings.push('stale fixture must not include a current digest');
  if (fixture.evidence?.currentHead !== null) findings.push('stale fixture must not include a current HEAD binding');
  if (fixture.expectedVerdict !== 'not-complete') findings.push('stale evidence expectedVerdict must remain not-complete');
  for (const forbidden of ['verified', 'pass', 'complete']) {
    if (!fixture.forbiddenVerdicts?.includes(forbidden)) findings.push(`missing forbidden verdict: ${forbidden}`);
  }
  for (const diagnostic of ['stale-evidence-is-nonterminal', 'stale-reference-must-not-green']) {
    if (!fixture.diagnostics?.includes(diagnostic)) findings.push(`missing diagnostic: ${diagnostic}`);
  }

  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan32StaleEvidenceNonterminalValidation.v1',
    ok,
    findings,
    verdict: fixture.expectedVerdict,
    failClosed: true,
    diagnostics: fixture.diagnostics ?? []
  };
  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan32-stale-evidence-nonterminal] ok verdict=${output.verdict} diagnostics=${output.diagnostics.join(',')}`);
  else console.error(`[validate-plan32-stale-evidence-nonterminal] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
