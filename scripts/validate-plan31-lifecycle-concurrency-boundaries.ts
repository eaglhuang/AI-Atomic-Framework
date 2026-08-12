#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/plan31-lifecycle-concurrency-boundaries.json');

function parseArgs(argv: string[]) {
  const options = { json: false, input: defaultFixturePath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-plan31-lifecycle-concurrency-boundaries.ts [--input <fixture.json>] [--json]');
      process.exit(0);
    }
  }
  return options;
}

function row(rows: any[], objectiveId: string): any {
  return rows.find((entry) => entry?.objectiveId === objectiveId) ?? {};
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.input)) throw new Error(`fixture missing: ${path.relative(root, options.input)}`);
  const fixture = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const rows = Array.isArray(fixture.rows) ? fixture.rows : [];
  const findings: string[] = [];

  if (fixture.schemaId !== 'atm.plan31LifecycleConcurrencyBoundariesFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (rows.length !== 6) findings.push(`expected 6 lifecycle/concurrency rows, observed ${rows.length}`);

  const twoKey = row(rows, 'P31-OBJ-06');
  if (twoKey.causalRequirementRepresented !== true || twoKey.singleActorCloseAllowed !== false || twoKey.dryRunMaySubstituteForClose !== false) {
    findings.push('P31-OBJ-06 two-key close must be causal and cannot be substituted by one actor or dry-run');
  }

  const queue = row(rows, 'P31-OBJ-11');
  if (queue.queueReceiptObservable !== true || queue.wakeupReceiptObservable !== true || queue.bareRefusalAllowed !== false) {
    findings.push('P31-OBJ-11 queue/wakeup receipts must be observable and never bare refusal');
  }

  const lifecycle = row(rows, 'P31-OBJ-12');
  if (lifecycle.reservePromoteClaimCloseRepresented !== true || lifecycle.commandBacked !== true || lifecycle.statusTextAloneAllowed !== false) {
    findings.push('P31-OBJ-12 lifecycle receipts must be command-backed, not status text alone');
  }

  const sealed = row(rows, 'P31-OBJ-14');
  if (sealed.sealedSetIndependentOfLiveResidue !== true || sealed.foreignStagedResidueIsAuthority !== false || sealed.candidateTreeRequired !== true) {
    findings.push('P31-OBJ-14 sealed set must be independent of live-index residue');
  }

  const rollback = row(rows, 'P31-OBJ-17');
  if (rollback.rollbackPathRetained !== true || rollback.rollbackExecutionRequiredForProof !== false || rollback.destructiveRollbackForbidden !== true) {
    findings.push('P31-OBJ-17 rollback path must be retained without destructive execution');
  }

  const actor = row(rows, 'P31-OBJ-20');
  if (actor.actorContinuityPreserved !== true || actor.receiptChainMachineReplayable !== true || actor.ambientActorSubstitutionAllowed !== false) {
    findings.push('P31-OBJ-20 actor continuity must be machine replayable without ambient actor substitution');
  }

  if (fixture.expectedVerdict !== 'plan31-lifecycle-concurrency-boundaries-proven') findings.push('expected verdict mismatch');

  const diagnostics = [
    'two-key-close-causal',
    'queue-wakeup-observable',
    'lifecycle-command-backed',
    'sealed-set-live-index-separated',
    'rollback-retained',
    'actor-continuity-replayable'
  ];
  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan31LifecycleConcurrencyBoundariesValidation.v1',
    ok,
    findings,
    verdict: ok ? 'plan31-lifecycle-concurrency-boundaries-proven' : 'plan31-lifecycle-concurrency-boundaries-not-proven',
    rowsCovered: rows.map((entry: any) => String(entry.objectiveId)),
    diagnostics
  };

  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan31-lifecycle-concurrency-boundaries] ok rows=${output.rowsCovered.length} diagnostics=${diagnostics.join(',')}`);
  else console.error(`[validate-plan31-lifecycle-concurrency-boundaries] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
