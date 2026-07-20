import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBatch } from '../../packages/cli/src/commands/batch/implementation.ts';
import { runGuide } from '../../packages/cli/src/commands/guide.ts';

const cwd = mkdtempSync(path.join(tmpdir(), 'atm-compose-first-default-'));
mkdirSync(path.join(cwd, 'docs'), { recursive: true });
writeFileSync(path.join(cwd, 'docs', 'plan.md'), '# Plan\n\n- ATM-GOV-0222C\n', 'utf8');

const composeFirst = await runBatch([
  'execute-plan', '--cwd', cwd, '--actor', 'codex-compose',
  '--plan', 'docs/plan.md', '--task', 'ATM-GOV-0222C', '--run-loop', '--json'
]);
assert.equal(composeFirst.ok, true);
const observations = (composeFirst.evidence as any).loopReceipt.observations;
const ticketed = observations.find((entry: any) => entry.extensions?.phase === 'broker-ticketed');
const composing = observations.find((entry: any) => entry.extensions?.phase === 'composing');
assert.equal(ticketed.extensions.composeFirstState, 'execute-ticket');
assert.equal(composing.extensions.composeFirstState, 'compose-parallel');

const queuedFallback = await runBatch([
  'execute-plan', '--cwd', cwd, '--actor', 'codex-compose',
  '--task', 'ATM-GOV-0222Q', '--run-loop', '--ticket', 'queued', '--json'
]);
assert.equal(queuedFallback.ok, true);
const queuedObservations = (queuedFallback.evidence as any).loopReceipt.observations;
assert.equal(
  queuedObservations.find((entry: any) => entry.extensions?.phase === 'broker-ticketed').extensions.composeFirstState,
  'queued-ticket'
);
assert.equal(
  queuedObservations.find((entry: any) => entry.extensions?.phase === 'composing').extensions.composeFirstState,
  'wakeup-compose'
);

const firstLayer = runGuide(['first-layer', '--json']);
const ticketStates = (firstLayer.evidence as any).ticketStates.map((entry: any) => entry.state);
assert.equal(ticketStates.includes('batch/applyStrategy=compose'), true);
assert.equal(ticketStates.includes('queue(position/head/health/waitedMs/release condition)'), true);
assert.match((firstLayer.evidence as any).frameworkAdopterDifference.join('\n'), /Adopter repositories/);

console.log('adopter compose-first default ok');
