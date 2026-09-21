#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/parallel-prepare-outside-queue.json');

function parseArgs(argv: string[]) {
  const options = { json: false, input: defaultFixturePath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-plan32-parallel-prepare-outside-queue.ts [--input <fixture.json>] [--json]');
      process.exit(0);
    }
  }
  return options;
}

function includesAll(values: unknown, required: string[]): boolean {
  if (!Array.isArray(values)) return false;
  const set = new Set(values.map(String));
  return required.every((value) => set.has(value));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.input)) throw new Error(`fixture missing: ${path.relative(root, options.input)}`);
  const fixture = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const findings: string[] = [];

  const workflow = fixture.workflow ?? {};
  const prepare = workflow.preparePhase ?? {};
  const critical = workflow.criticalSection ?? {};
  const validation = workflow.validationPhase ?? {};
  const requiredForbiddenActions = [
    'hold-queue-during-prepare',
    'hold-queue-during-validation',
    'treat-wait-as-pass'
  ];
  const requiredDiagnostics = [
    'prepare-outside-queue',
    'validation-outside-queue',
    'critical-section-only'
  ];

  if (fixture.schemaId !== 'atm.plan3ParallelPrepareOutsideQueueFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (prepare.parallelizable !== true) findings.push('prepare phase must be parallelizable');
  if (prepare.insideScarceQueue !== false) findings.push('prepare phase must stay outside scarce queue');
  if (validation.parallelizable !== true) findings.push('validation phase must be parallelizable');
  if (validation.insideScarceQueue !== false) findings.push('validation phase must stay outside scarce queue');
  if (critical.insideScarceQueue !== true) findings.push('critical section must be inside scarce queue');
  if (!Number.isFinite(critical.durationMs) || critical.durationMs > 10000) findings.push('critical queue residency must be bounded to <=10000ms');
  if (!Array.isArray(critical.operations) || critical.operations.length === 0) findings.push('critical operations missing');
  if (fixture.expectedVerdict !== 'queue-residency-minimal') findings.push('expected verdict mismatch');
  if (!includesAll(fixture.forbiddenActions, requiredForbiddenActions)) findings.push('forbidden action coverage missing');
  if (!includesAll(fixture.diagnostics, requiredDiagnostics)) findings.push('diagnostic coverage missing');

  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan32ParallelPrepareOutsideQueueValidation.v1',
    ok,
    findings,
    verdict: ok ? 'queue-residency-minimal' : 'queue-residency-not-proven',
    queueResidencyMs: Number(critical.durationMs ?? 0),
    diagnostics: requiredDiagnostics
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else if (ok) {
    console.log(`[validate-plan32-parallel-prepare-outside-queue] ok queueResidencyMs=${output.queueResidencyMs} diagnostics=${output.diagnostics.join(',')}`);
  } else {
    console.error(`[validate-plan32-parallel-prepare-outside-queue] failed: ${findings.join('; ')}`);
  }
  process.exit(ok ? 0 : 1);
}

main();
