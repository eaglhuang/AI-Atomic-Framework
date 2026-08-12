#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/shared-delivery-no-override.json');

function parseArgs(argv: string[]) {
  const options = { json: false, input: defaultFixturePath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-plan32-shared-delivery-no-override.ts [--input <fixture.json>] [--json]');
      process.exit(0);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.input)) throw new Error(`fixture missing: ${path.relative(root, options.input)}`);
  const fixture = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const findings: string[] = [];

  const shared = fixture.sharedDelivery ?? {};
  const override = fixture.override ?? {};
  if (fixture.schemaId !== 'atm.plan3SharedDeliveryNoOverrideFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (shared.authorized !== true) findings.push('shared delivery must be authorized');
  if (shared.deliveryMode !== 'steward-composed') findings.push('shared delivery must use steward-composed mode');
  if (shared.memberAttributionRequired !== true) findings.push('member attribution must be required');
  if (!Array.isArray(shared.scope) || shared.scope.length < 2) findings.push('shared delivery scope must name multiple participants');
  if (override.leasePresent !== false) findings.push('override lease must be absent');
  if (override.emergencyBypass !== false) findings.push('emergency bypass must be absent');
  if (override.manualForeignBytesAllowed !== false) findings.push('manual foreign bytes must be forbidden');
  if (fixture.expectedVerdict !== 'shared-delivery-separated-from-override') findings.push('expected verdict mismatch');

  const diagnostics = [
    'shared-delivery-authorized',
    'member-attribution-required',
    'override-lease-absent',
    'manual-foreign-bytes-forbidden'
  ];
  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan32SharedDeliveryNoOverrideValidation.v1',
    ok,
    findings,
    verdict: ok ? 'shared-delivery-separated-from-override' : 'shared-delivery-override-boundary-not-proven',
    deliveryMode: String(shared.deliveryMode ?? ''),
    overrideLeasePresent: Boolean(override.leasePresent),
    diagnostics
  };

  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan32-shared-delivery-no-override] ok mode=${output.deliveryMode} diagnostics=${diagnostics.join(',')}`);
  else console.error(`[validate-plan32-shared-delivery-no-override] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
