#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/batch-split-handoff-boundary.json');

function parseArgs(argv: string[]) {
  const options = { json: false, input: defaultFixturePath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-plan32-batch-split-handoff-boundary.ts [--input <fixture.json>] [--json]');
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
  const split = fixture.batchSplit ?? {};
  const handoff = fixture.handoff ?? {};

  if (fixture.schemaId !== 'atm.plan3BatchSplitHandoffBoundaryFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (!String(split.batchId ?? '').startsWith('batch-')) findings.push('batch id missing');
  if (!Array.isArray(split.childTasks) || split.childTasks.length < 2) findings.push('batch split must name multiple child tasks');
  if (split.checkpointRequired !== true) findings.push('batch checkpoint must be required');
  if (split.queueHeadOnly !== true) findings.push('batch checkpoint must remain queue-head only');
  if (handoff.continuationSummaryPresent !== true) findings.push('handoff summary must be present');
  if (handoff.claimsCompletion !== false) findings.push('handoff must not claim completion');
  if (handoff.canReplaceCheckpoint !== false) findings.push('handoff must not replace checkpoint');
  if (fixture.expectedVerdict !== 'batch-split-and-handoff-separated') findings.push('expected verdict mismatch');

  const diagnostics = [
    'batch-checkpoint-required',
    'handoff-is-continuation-only',
    'handoff-cannot-close-batch',
    'queue-head-only'
  ];
  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan32BatchSplitHandoffBoundaryValidation.v1',
    ok,
    findings,
    verdict: ok ? 'batch-split-and-handoff-separated' : 'batch-split-handoff-boundary-not-proven',
    batchId: String(split.batchId ?? ''),
    childTaskCount: Array.isArray(split.childTasks) ? split.childTasks.length : 0,
    diagnostics
  };

  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan32-batch-split-handoff-boundary] ok batch=${output.batchId} children=${output.childTaskCount} diagnostics=${diagnostics.join(',')}`);
  else console.error(`[validate-plan32-batch-split-handoff-boundary] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
