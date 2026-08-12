import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/queue-only-no-override.json');

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
      console.log('Usage: node --strip-types scripts/validate-plan32-queue-only-no-override.ts [--input <json>] [--json]');
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
  const decision = fixture.queueDecision ?? {};

  if (fixture.schemaId !== 'atm.plan3QueueOnlyNoOverrideFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (decision.state !== 'waiting') findings.push('queue decision must remain waiting');
  if (decision.queueRequired !== true) findings.push('queueRequired must be true');
  if (decision.overrideLease !== null) findings.push('overrideLease must be absent');
  if (decision.emergencyApproval !== null) findings.push('emergencyApproval must be absent');
  if (decision.releaseCondition !== 'queue-head') findings.push('releaseCondition must be queue-head');
  if (fixture.expectedVerdict !== 'wait-only') findings.push('expectedVerdict mismatch');
  for (const forbidden of ['bypass-queue', 'grant-override', 'mark-ready']) {
    if (!fixture.forbiddenActions?.includes(forbidden)) findings.push(`missing forbidden action: ${forbidden}`);
  }
  for (const diagnostic of ['queue-is-required', 'override-lease-absent', 'wait-does-not-green']) {
    if (!fixture.diagnostics?.includes(diagnostic)) findings.push(`missing diagnostic: ${diagnostic}`);
  }

  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan32QueueOnlyNoOverrideValidation.v1',
    ok,
    findings,
    verdict: fixture.expectedVerdict,
    queueRequired: decision.queueRequired === true,
    overridePresent: decision.overrideLease !== null || decision.emergencyApproval !== null,
    diagnostics: fixture.diagnostics ?? []
  };
  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan32-queue-only-no-override] ok verdict=${output.verdict} diagnostics=${output.diagnostics.join(',')}`);
  else console.error(`[validate-plan32-queue-only-no-override] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
