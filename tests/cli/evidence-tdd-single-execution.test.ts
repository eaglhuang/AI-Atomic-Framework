import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runEvidenceRun } from '../../packages/cli/src/commands/evidence/verbs/run.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-tdd-single-'));
const script = path.join(cwd, 'validator.mjs');
const counter = path.join(cwd, 'counter');
writeFileSync(script, `import {existsSync,readFileSync,writeFileSync} from 'node:fs';
const n=existsSync('counter')?Number(readFileSync('counter','utf8'))+1:1;
writeFileSync('counter',String(n));
console.log('execution:'+n);
if(process.env.ATM_LANE_SESSION_ID) throw new Error('inherited lane');
process.exit(Number(process.argv[2]??0));\n`);
const args = (task: string, phase: string, exit: number, extra: string[] = []) => [
  '--cwd', cwd, '--task', task, '--actor', 'tdd-validator',
  '--command', `${process.platform === 'win32' ? '& ' : ''}"${process.execPath}" "${script}" ${exit}`,
  '--tdd-phase', phase, '--tdd-case-id', 'test_task_evidence_aaaaaaaa',
  '--tdd-test-digest', `sha256:${'a'.repeat(64)}`, '--tdd-acceptance', 'ACC-1',
  '--tdd-public-seam', 'evidence run', '--tdd-baseline-sha', 'a'.repeat(40),
  '--tdd-candidate-sha', 'b'.repeat(40), '--tdd-executed-cases', '1',
  '--tdd-assertions', '1', ...extra, '--json'
];
const oldLane = process.env.ATM_LANE_SESSION_ID;
process.env.ATM_LANE_SESSION_ID = 'foreign-parent-lane';
try {
  const green = runEvidenceRun(args('TASK-SINGLE-GREEN', 'green', 0));
  const greenObservation = green.evidence.tddObservation as any;
  assert.equal(green.ok, true);
  assert.equal(readFileSync(counter, 'utf8'), '1');
  const persisted = JSON.parse(readFileSync(path.join(cwd, String(green.evidence.evidencePath)), 'utf8'));
  const runs = persisted.evidence.flatMap((entry: any) => entry.details?.commandRuns ?? []);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].stdoutSha256, `sha256:${greenObservation.stdoutSha256}`);
  assert.equal(runs[0].durationMs, greenObservation.durationMs);
  const recent = runEvidenceRun(args('TASK-SINGLE-GREEN', 'green', 0, ['--recent-run']));
  const recentObservation = recent.evidence.tddObservation as any;
  assert.equal(readFileSync(counter, 'utf8'), '2');
  assert.notEqual(recentObservation.stdoutSha256, greenObservation.stdoutSha256);
  const recentPersisted = JSON.parse(readFileSync(path.join(cwd, String(recent.evidence.evidencePath)), 'utf8'));
  const latest = recentPersisted.evidence.at(-1).details.commandRuns[0];
  assert.equal(latest.stdoutSha256, `sha256:${recentObservation.stdoutSha256}`);
  assert.equal(latest.cached, false);
  const red = runEvidenceRun(args('TASK-SINGLE-RED', 'red', 1,
    ['--tdd-failure-class', 'assertion-failure', '--tdd-expected-red-predicate', 'expected regression']));
  assert.equal((red.evidence.tddCycle as any).countsAsRed, true);
  assert.equal(readFileSync(counter, 'utf8'), '3');
  const redPersisted = JSON.parse(readFileSync(path.join(cwd, String(red.evidence.evidencePath)), 'utf8'));
  assert.equal(redPersisted.evidence[0].details.commandRuns[0].exitCode, 1);
  assert.equal((red.evidence.bundleManifest as any).freshValidationPasses.length, 0);
  assert.throws(() => runEvidenceRun(args('TASK-SINGLE-INVALID', 'green', 0,
    ['--tdd-assertions', '0'])), (error: any) => error.code === 'ATM_TDD_PHASE_RECEIPT_INVALID');
  assert.equal(readFileSync(counter, 'utf8'), '4');
  assert.equal(existsSync(path.join(cwd, '.atm/runtime/evidence-ledger/bundles/TASK-SINGLE-INVALID.json')), false);
  console.log('ok: TDD executes once; persisted result parity; fresh recent-run; invalid receipt writes nothing');
} finally {
  if (oldLane === undefined) delete process.env.ATM_LANE_SESSION_ID;
  else process.env.ATM_LANE_SESSION_ID = oldLane;
  rmSync(cwd, { recursive: true, force: true });
}
