import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertSealedRunnerClaimLifetime, MIN_PUBLICATION_CLAIM_REMAINING_SECONDS, resolveActiveRunnerPublicationTask } from '../../scripts/sealed-runner-publication.ts';

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
assert.throws(() => check(), /framework-mode claim --actor fixture-bot --files release\/atm-onefile\/atm\.mjs,release\/atm-root-drop.*framework-mode release.*ATM_ACTOR_ID/);
claim(14400);
check();
// Concurrent ownership change remains authoritative, never renewed implicitly.
claim(14400, 'other-session');
assert.throws(() => check(1800), /found 0/);
// Fixed-TTL temporary release claims use live authority at both boundaries.
const tempTaskId = `ATM-FRAMEWORK-TEMP-${actorId}`;
const lockPath = path.join(cwd, '.atm/runtime/locks', `${tempTaskId}.lock.json`);
mkdirSync(path.dirname(lockPath), { recursive: true });
function tempClaim(extras: Record<string, unknown> = {}): void {
  writeFileSync(lockPath, JSON.stringify({ workItemId: tempTaskId, actorId,
    lockedAt: new Date(start).toISOString(), ttlSeconds: 1800,
    files: ['release/atm-onefile/**'], ...extras }));
}
function tempCheck(elapsedSeconds = 0): void {
  assertSealedRunnerClaimLifetime({ cwd, actorId, taskId: tempTaskId,
    now: new Date(start + elapsedSeconds * 1000).toISOString() });
}
tempClaim();
tempCheck();
tempCheck(1799);
assert.throws(() => tempCheck(1801), /found 0.*framework-mode status --json/);
assert.throws(() => resolveActiveRunnerPublicationTask({ cwd, actorId, taskId: tempTaskId,
  now: new Date(start + 1801 * 1000).toISOString() }), /found 0/);
for (const invalid of [{ actorId: 'other-session' }, { status: 'released' }, { files: ['unrelated.txt'] }]) {
  tempClaim(invalid);
  assert.throws(() => tempCheck(), /found 0/);
}
const build = readFileSync('scripts/run-sealed-runner-build.ts', 'utf8');
assert.ok(build.indexOf('assertSealedRunnerClaimLifetime({') < build.indexOf('const preBuildPublicationSnapshots ='));
assert.ok(build.indexOf('assertSealedRunnerClaimLifetime({') < build.indexOf("timePhase(timings, 'inputHashCalculationMs'", build.indexOf('function runSealedBuild')));
console.log('claim lifetime: short, renewed, long build, expiry, ownership race and pre-build ordering passed');
