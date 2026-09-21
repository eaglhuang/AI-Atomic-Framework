import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/attestation-only-nonterminal.json');

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
      console.log('Usage: node --strip-types scripts/validate-plan32-attestation-boundary.ts [--input <json>] [--json]');
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

  if (fixture.schemaId !== 'atm.plan3AttestationOnlyNonterminalFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (fixture.evidence?.kind !== 'public-attestation') findings.push('fixture must model public attestation evidence');
  if (typeof fixture.evidence?.statement !== 'string' || fixture.evidence.statement.length === 0) findings.push('attestation statement missing');
  if (fixture.evidence?.machineReceipt !== null) findings.push('attestation-only fixture must not include a machine receipt');
  if (fixture.evidence?.commandOutput !== null) findings.push('attestation-only fixture must not include command output');
  if (fixture.evidence?.verifiedDigest !== null) findings.push('attestation-only fixture must not include a verified digest');
  if (fixture.expectedVerdict !== 'not-complete') findings.push('attestation-only expectedVerdict must remain not-complete');
  for (const forbidden of ['verified', 'pass', 'complete']) {
    if (!fixture.forbiddenVerdicts?.includes(forbidden)) findings.push(`missing forbidden verdict: ${forbidden}`);
  }
  for (const diagnostic of ['attestation-is-not-machine-proof', 'prose-must-not-green']) {
    if (!fixture.diagnostics?.includes(diagnostic)) findings.push(`missing diagnostic: ${diagnostic}`);
  }

  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan32AttestationBoundaryValidation.v1',
    ok,
    findings,
    verdict: fixture.expectedVerdict,
    failClosed: true,
    diagnostics: fixture.diagnostics ?? []
  };
  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan32-attestation-boundary] ok verdict=${output.verdict} diagnostics=${output.diagnostics.join(',')}`);
  else console.error(`[validate-plan32-attestation-boundary] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
