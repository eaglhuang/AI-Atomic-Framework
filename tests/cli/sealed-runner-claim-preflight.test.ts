import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertSealedRunnerClaimLifetime, MIN_PUBLICATION_CLAIM_REMAINING_SECONDS } from '../../scripts/sealed-runner-claim-preflight.ts';

mkdirSync('.atm-temp', { recursive: true });
const cwd = mkdtempSync(path.resolve('.atm-temp/claim-preflight-'));
const taskId = 'TASK-BUILD-0001';
const actorId = 'fixture-bot';
const start = Date.parse('2026-01-01T00:00:00.000Z');
mkdirSync(path.join(cwd, '.atm/history/tasks'), { recursive: true });
const taskPath = path.join(cwd, '.atm/history/tasks', `${taskId}.json`);
function claim(ttlSeconds: number, owner = actorId): void {
  writeFileSync(taskPath, JSON.stringify({ workItemId: taskId, status: 'in_progress', scopePaths: ['release/atm-onefile/**'],
    claim: { state: 'active', actorId: owner, heartbeatAt: new Date(start).toISOString(), ttlSeconds } }));
}
function check(elapsedSeconds = 0): void {
  assertSealedRunnerClaimLifetime({ cwd, actorId, taskId, now: new Date(start + elapsedSeconds * 1000).toISOString() });
}
claim(1800);
assert.throws(() => check(), /insufficient lifetime.*tasks renew --task TASK-BUILD-0001 --actor fixture-bot --ttl-seconds 14400/);
claim(14400);
check();
check(1801); // A thirty-minute private build remains publishable.
check(14400 - MIN_PUBLICATION_CLAIM_REMAINING_SECONDS);
assert.throws(() => check(14401), /Renew publication authority before building/);
claim(14400, 'other-session');
assert.throws(() => check(), /Renew publication authority/);
claim(14400);
check();
// Concurrent ownership change remains authoritative, never renewed implicitly.
claim(14400, 'other-session');
assert.throws(() => check(1800), /found 0/);
const build = readFileSync('scripts/run-sealed-runner-build.ts', 'utf8');
assert.ok(build.indexOf('assertSealedRunnerClaimLifetime({') < build.indexOf('const preBuildPublicationSnapshots ='));
assert.ok(build.indexOf('assertSealedRunnerClaimLifetime({') < build.indexOf("timePhase(timings, 'inputHashCalculationMs'", build.indexOf('function runSealedBuild')));
console.log('claim lifetime: short, renewed, long build, expiry, ownership race and pre-build ordering passed');
