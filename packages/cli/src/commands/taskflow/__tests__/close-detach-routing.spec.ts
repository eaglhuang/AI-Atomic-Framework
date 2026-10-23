import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { runTaskflow } from '../../taskflow.ts';
import { closeAttemptPaths, readCloseAttempt } from '../close-attempt.ts';
import { makeDualRepoCloseFixture, writeJson } from './dryrun/fixtures.ts';
const fixture = await makeDualRepoCloseFixture('detached-routing', { closePlanningStatus: 'running' });
const oldLane = process.env.ATM_LANE_SESSION_ID;
const ledger = JSON.parse(readFileSync(path.join(fixture.targetRepo, '.atm/history/tasks', `${fixture.taskId}.json`), 'utf8'));
process.env.ATM_LANE_SESSION_ID = ledger.claim.laneSession.laneSessionId;
const git = (args: string[]) => execFileSync('git', args, { cwd: fixture.targetRepo, encoding: 'utf8' });
try {
  const foreign = '.atm/history/tasks/TASK-FOREIGN.json';
  writeJson(path.join(fixture.targetRepo, foreign), { workItemId: 'TASK-FOREIGN', status: 'running', claim: { actorId: 'other', leaseId: 'foreign-one', state: 'active', heartbeatAt: new Date().toISOString(), ttlSeconds: 3600, files: [foreign] } });
  git(['add', foreign]); const foreignIndex = git(['ls-files','-s','--',foreign]);
  const args = ['close','--cwd',fixture.targetRepo,'--profile',fixture.profilePath,'--task',fixture.taskId,'--actor','validator','--historical-delivery',fixture.deliveryCommit,'--defer-foreign-staged','--write'];
  const cli = fileURLToPath(new URL('../../../atm.ts', import.meta.url));
  const started = spawnSync(process.execPath, ['--strip-types',cli,'taskflow',...args,'--detach','--json'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(started.status, 0, started.stderr + started.stdout);
  assert.equal(started.stdout.trim().split('\n').length, 1);
  assert.match(started.stdout, /CLOSE_STARTED/);
  const id = /attempt=([A-Za-z0-9-]+)/.exec(started.stdout)![1];
  const waited = await runTaskflow(['close','--cwd',fixture.targetRepo,'--task',fixture.taskId,'--wait','--attempt',id,'--timeout-ms','30000']) as any;
  if (!/CLOSE_COMMITTED/.test(waited.closeResultLine)) throw new Error(`${waited.closeResultLine}\n${readFileSync(closeAttemptPaths(fixture.targetRepo, fixture.taskId,id).log,'utf8').slice(-5000)}`);
  assert.equal(git(['ls-files','-s','--',foreign]), foreignIndex, 'foreign staged blob/mode preserved by real detached close');
  assert.equal(JSON.parse(git(['show',`HEAD:.atm/history/tasks/${fixture.taskId}.json`])).status,'done');
  const attempt = readCloseAttempt(fixture.targetRepo,fixture.taskId,id);
  // Status can observe the committed transaction just before the worker writes
  // its final attempt record, so wait for the actual child acknowledgement too.
  const deadline = Date.now()+5000;
  while (readCloseAttempt(fixture.targetRepo,fixture.taskId,id)?.state === 'running' && Date.now()<deadline) await new Promise(r=>setTimeout(r,20));
  assert.ok(readCloseAttempt(fixture.targetRepo,fixture.taskId,id)?.closeTiming);
  assert.ok(attempt?.ownerPid);
  const status = spawnSync(process.execPath, ['--strip-types',cli,'taskflow','close','--cwd',fixture.targetRepo,'--task',fixture.taskId,'--status','--attempt',id,'--json'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(status.status, 0, `${status.error ?? ""} ${status.stderr}`);
  assert.equal(status.stdout.trim().split('\n').length, 1);
  assert.match(status.stdout, /CLOSE_COMMITTED/);
  await assert.rejects(runTaskflow(['close','--cwd',fixture.targetRepo,'--task',fixture.taskId,'--detach']), /requires close --write/);
  await assert.rejects(runTaskflow(['close','--cwd',fixture.targetRepo,'--task',fixture.taskId,'--status','--write','--attempt',id]), /cannot be combined/);
  console.log('close-detach-routing: actual source worker committed; attempt wait and foreign staged index preserved');
} finally {
  if (oldLane === undefined) delete process.env.ATM_LANE_SESSION_ID; else process.env.ATM_LANE_SESSION_ID = oldLane;
  rmSync(path.dirname(fixture.targetRepo), { recursive: true, force: true });
}
