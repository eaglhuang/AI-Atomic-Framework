#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultInput = path.join(root, 'tests/fixtures/plan3-fake-green/git-head-provenance-mismatch.json');

function parseArgs(argv: string[]) {
  const options = { input: defaultInput, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
    else if (arg === '--json') options.json = true;
  }
  return options;
}

function isSha(value: unknown): boolean {
  return /^[0-9a-f]{40}$/i.test(String(value ?? ''));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const findings: string[] = [];
  if (!existsSync(options.input)) throw new Error(`provenance mismatch fixture missing: ${path.relative(root, options.input)}`);
  const fixture = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));

  if (fixture.schemaId !== 'atm.plan3GitHeadProvenanceMismatchFixture.v1') findings.push('schemaId mismatch');
  if (!isSha(fixture.currentHead)) findings.push('currentHead must be a 40-hex commit-like sha');
  if (!isSha(fixture.evidenceHead)) findings.push('evidenceHead must be a 40-hex commit-like sha');
  if (fixture.currentHead === fixture.evidenceHead) findings.push('fixture must exercise a head mismatch');
  if (fixture.expectedTaskId !== 'ATM-GOV-0335') findings.push('expectedTaskId must remain ATM-GOV-0335');
  if (fixture.observedTaskId === fixture.expectedTaskId) findings.push('fixture must exercise a task provenance mismatch');
  if (!Array.isArray(fixture.diagnostics) || !fixture.diagnostics.includes('head-mismatch') || !fixture.diagnostics.includes('task-provenance-mismatch')) {
    findings.push('diagnostics must include both head-mismatch and task-provenance-mismatch');
  }
  if (fixture.expectedVerdict !== 'fail-closed') findings.push('provenance mismatch must fail closed');

  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan32ProvenanceMismatchValidation.v1',
    ok,
    findings,
    verdict: fixture.expectedVerdict,
    failClosed: fixture.expectedVerdict === 'fail-closed',
    diagnostics: fixture.diagnostics ?? []
  };

  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log('[validate-plan32-provenance-mismatch] ok verdict=fail-closed diagnostics=head-mismatch,task-provenance-mismatch');
  else console.error(`[validate-plan32-provenance-mismatch] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
