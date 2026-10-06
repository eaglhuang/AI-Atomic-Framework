import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseClaimLifecycleOptions } from '../../packages/cli/src/commands/tasks/task-option-parsers/misc-claim-options.ts';
import { createEmergencyLease, readEmergencyLease } from '../../packages/cli/src/commands/emergency/leases.ts';
import { extractUnownedWipAdoption } from '../../packages/cli/src/commands/next/unowned-wip-adoption.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The same regression can verify an admitted frozen artifact without rebuilding it.
const entrypoint = process.env.ATM_ADOPTION_TEST_ENTRYPOINT ?? path.join(root, 'packages/cli/src/atm.ts');
const taskId = 'TASK-ADOPTION-0001';
const actor = 'adoption-fixture';
const tracked = 'packages/cli/src/tracked.ts';
const untracked = 'packages/cli/src/new.ts';
const outside = 'packages/cli/src/outside.ts';
const scope = [tracked, untracked];
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

function isolatedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('ATM_') || key === 'AGENT_IDENTITY' || key.startsWith('GIT_')) delete env[key];
  }
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = os.devNull;
  return env;
}

function git(cwd: string, args: string[]): string {
  const run = spawnSync('git', args, { cwd, env: isolatedEnv(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

function write(cwd: string, relative: string, value: string | object) {
  const file = path.join(cwd, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

function read(cwd: string, relative: string): any {
  return JSON.parse(readFileSync(path.join(cwd, relative), 'utf8'));
}

function runAtm(cwd: string, args: string[]) {
  const run = spawnSync(process.execPath, ['--strip-types', entrypoint, ...args, '--cwd', cwd, '--json'], {
    cwd, env: isolatedEnv(), encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024
  });
  const output = (run.stdout || run.stderr).trim();
  let result: any;
  try { result = JSON.parse(output); } catch { assert.fail(`No CLI JSON: ${output.slice(0, 2000)}`); }
  return { status: run.status, result };
}

function fixture() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-claim-adoption-'));
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.name', 'Adoption Fixture']);
  git(cwd, ['config', 'user.email', 'adoption-fixture@example.invalid']);
  write(cwd, '.atm/config.json', { schemaVersion: 'atm.config.v0.1', layoutVersion: 2,
    taskLedger: { enabled: true, mode: 'auto', requireCliTransitions: true } });
  write(cwd, '.atm/registry.json', { entries: [] });
  write(cwd, '.atm/git-baseline.json', { schemaId: 'atm.gitBaseline.v1', repoRoot: cwd, commit: 'HEAD' });
  write(cwd, tracked, 'export const value = 1;\n');
  write(cwd, outside, 'export const outside = 1;\n');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-qm', 'fixture baseline']);
  const registration = runAtm(cwd, ['actor', 'register', '--id', actor, '--kind', 'ai-agent',
    '--name', 'Adoption Fixture', '--git-name', 'Adoption Fixture', '--git-email', 'adoption-fixture@example.invalid']);
  assert.equal(registration.status, 0, JSON.stringify(registration.result));
  write(cwd, `.atm/history/tasks/${taskId}.json`, {
    schemaVersion: 'atm.workItem.v0.2', workItemId: taskId, title: 'Bounded adoption fixture',
    status: 'planned', scopePaths: scope, deliverables: scope, targetAllowedFiles: scope,
    targetRepo: 'fixture', closureAuthority: 'target_repo', source: { planPath: null }
  });
  write(cwd, tracked, 'export const value = 2;\n');
  write(cwd, outside, 'export const outside = 2;\n');
  git(cwd, ['add', '--', tracked, outside]);
  write(cwd, tracked, 'export const value = 3;\n');
  write(cwd, outside, 'export const outside = 3;\n');
  write(cwd, untracked, 'export const created = true;\n');
  return cwd;
}

function snapshot(cwd: string) {
  return {
    head: git(cwd, ['rev-parse', 'HEAD']),
    entries: git(cwd, ['ls-files', '--stage', '-z']),
    staged: git(cwd, ['diff', '--cached', '--binary']),
    sourceHashes: [tracked, untracked, outside].map(file => [file, hash(readFileSync(path.join(cwd, file)))])
  };
}

function governanceSnapshot(cwd: string): string[] {
  const walk = (dir: string): string[] => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    // CLI diagnostics may append telemetry; task, lane, queue and authority state must not change.
    if (path.relative(cwd, file).replace(/\\/g, '/') === '.atm/runtime/telemetry') return [];
    return entry.isDirectory() ? walk(file) : [`${path.relative(cwd, file)}:${hash(readFileSync(file))}`];
  }) : [];
  return walk(path.join(cwd, '.atm')).sort();
}

function claim(cwd: string, extra: string[] = []) {
  return runAtm(cwd, ['next', '--claim', '--task', taskId, '--actor', actor, '--auto-intent', ...extra]);
}

function withFixture(fn: (cwd: string) => void) {
  const cwd = fixture();
  try { fn(cwd); } finally { rmSync(cwd, { recursive: true, force: true }); }
}

test('backend parser keeps adoption explicit and disabled by default', () => {
  const args = ['--task', taskId, '--actor', actor, '--files', tracked];
  assert.equal(parseClaimLifecycleOptions('claim', args).adoptUnownedWip, false);
  assert.equal(parseClaimLifecycleOptions('claim', [...args, '--adopt-unowned-wip']).adoptUnownedWip, true);
});

test('adoption selector validation rejects inline aliases and duplicate claim flags', () => {
  const base = ['--claim', '--task', taskId, '--adopt-unowned-wip'];
  for (const extra of ['--files=packages/**', `--task=${taskId}`, `--tasks=${taskId}`,
    '--prompt=continue', '--intent=other.json', '--claim', '--claim=true']) {
    assert.throws(() => extractUnownedWipAdoption([...base, extra]), { code: 'ATM_CLI_USAGE' });
  }
  assert.throws(() => extractUnownedWipAdoption(['--claim', '--task', taskId, '--adopt-unowned-wip=true']), { code: 'ATM_CLI_USAGE' });
  assert.deepEqual(extractUnownedWipAdoption(base), { argv: base.slice(0, -1), enabled: true });
});

test('default claim refuses staged, unstaged and untracked code without changing preimages', () => withFixture(cwd => {
  const before = snapshot(cwd);
  const run = claim(cwd);
  assert.equal(run.status, 1);
  assert.equal(run.result.messages[0].code, 'ATM_CLAIM_FOREIGN_UNSTAGED_WIP');
  const blockers = run.result.messages[0].data.blockers;
  assert.deepEqual(blockers.find((entry: any) => entry.file === tracked).changeKinds, ['staged', 'unstaged']);
  assert.deepEqual(blockers.find((entry: any) => entry.file === untracked).changeKinds, ['untracked']);
  assert.equal(read(cwd, `.atm/history/tasks/${taskId}.json`).claim, undefined);
  assert.deepEqual(snapshot(cwd), before);
}));

test('explicit exact-task adoption reaches inner claim and preserves source/index preimages', () => withFixture(cwd => {
  const before = snapshot(cwd);
  const run = claim(cwd, ['--adopt-unowned-wip']);
  assert.equal(run.status, 0, JSON.stringify(run.result));
  assert.equal(run.result.evidence.recommendedChannel, 'normal');
  const evidence = run.result.evidence.claimResult;
  assert.equal(evidence.unownedWipAdoption, true);
  assert.equal(evidence.claimIntent, 'write');
  const task = read(cwd, `.atm/history/tasks/${taskId}.json`);
  assert.equal(task.status, 'running');
  assert.equal(task.claim.state, 'active');
  assert.equal(task.claim.actorId, actor);
  const ticket = evidence.workAdmissionTicket;
  assert.equal(ticket.taskId, taskId);
  assert.equal(ticket.actorId, actor);
  assert.equal(ticket.claimGeneration, task.claim.leaseId);
  assert.equal(ticket.laneSessionId, task.claim.laneSession.laneSessionId);
  const grantedFiles = ticket.grants.find((grant: any) => grant.kind === 'file-write').values;
  assert.deepEqual(grantedFiles.filter((file: string) => !file.startsWith('.atm/')).sort(), [...scope].sort());
  assert.ok(!task.claim.files.includes(outside));
  assert.deepEqual(snapshot(cwd), before);

  const registration = runAtm(cwd, ['actor', 'register', '--id', 'intruder', '--kind', 'ai-agent',
    '--name', 'Intruder Fixture', '--git-name', 'Intruder Fixture', '--git-email', 'intruder@example.invalid']);
  assert.equal(registration.status, 0);
  const foreignActor = runAtm(cwd, ['next', '--claim', '--task', taskId, '--actor', 'intruder', '--adopt-unowned-wip']);
  assert.equal(foreignActor.status, 1, JSON.stringify(foreignActor.result));
  assert.ok(['ATM_LOCK_CONFLICT', 'ATM_LANE_SESSION_OWNERSHIP_MISMATCH'].includes(foreignActor.result.messages[0].code));
  const otherLane = runAtm(cwd, ['lane', 'status', '--actor', 'intruder']);
  assert.equal(otherLane.status, 0);
  const foreignLane = runAtm(cwd, ['next', '--claim', '--task', taskId, '--actor', 'intruder',
    '--adopt-unowned-wip', '--lane-session', otherLane.result.evidence.laneSession.laneSessionId]);
  assert.equal(foreignLane.status, 1, JSON.stringify(foreignLane.result));
  assert.ok(['ATM_LANE_SESSION_OWNERSHIP_MISMATCH', 'ATM_LANE_SESSION_ACTOR_MISMATCH'].includes(foreignLane.result.messages[0].code));
  assert.deepEqual(read(cwd, `.atm/history/tasks/${taskId}.json`).claim, task.claim);
  assert.deepEqual(snapshot(cwd), before);
  // Existing same-actor resume deliberately keeps its holding lane; adoption cannot transfer it.
  const retry = claim(cwd, ['--adopt-unowned-wip', '--lane-session', otherLane.result.evidence.laneSession.laneSessionId]);
  assert.equal(retry.status, 0, JSON.stringify(retry.result));
  assert.equal(retry.result.evidence.claimResult.reusedActiveClaim, true);
  assert.equal(read(cwd, `.atm/history/tasks/${taskId}.json`).claim.laneSession.laneSessionId, task.claim.laneSession.laneSessionId);
  assert.deepEqual(snapshot(cwd), before);
}));

for (const ownership of ['active', 'retained'] as const) {
  test(`adoption cannot take ${ownership} foreign WIP`, () => withFixture(cwd => {
    const ownerTask = 'TASK-OWNER-0001';
    write(cwd, `.atm/history/tasks/${ownerTask}.json`, {
      workItemId: ownerTask, status: ownership === 'active' ? 'running' : 'open',
      ...(ownership === 'active' ? { claim: { state: 'active', actorId: 'foreign-owner', files: [tracked],
        leaseId: 'fixture-owner-lease', laneSession: { laneSessionId: 'fixture-owner-lane' } } }
        : { wipOwnership: { schemaId: 'atm.retainedWipOwnership.v1', taskId: ownerTask,
          actorId: 'foreign-owner', laneSessionId: 'fixture-owner-lane', dirtyPaths: [tracked] } })
    });
    const before = snapshot(cwd);
    const run = claim(cwd, ['--adopt-unowned-wip']);
    assert.equal(run.status, 1, JSON.stringify(run.result));
    assert.equal(run.result.messages[0].code, 'ATM_CLAIM_FOREIGN_UNSTAGED_WIP');
    assert.equal(run.result.messages[0].data.ownership, 'foreign');
    assert.equal(read(cwd, `.atm/history/tasks/${taskId}.json`).claim, undefined);
    assert.deepEqual(snapshot(cwd), before);
  }));
}

for (const extra of [
  ['--files', outside], ['--files', 'packages/**'], ['--tasks', taskId], ['--prompt', `Continue ${taskId}`],
  ['--intent', 'missing-intent.json'], ['--task', taskId], ['--adopt-unowned-wip']
]) {
  test(`adoption rejects selector override ${extra.join(' ')} before routing`, () => withFixture(cwd => {
    const before = snapshot(cwd);
    const governance = governanceSnapshot(cwd);
    const run = claim(cwd, ['--adopt-unowned-wip', ...extra]);
    assert.equal(run.status, 2, JSON.stringify(run.result));
    assert.equal(run.result.messages[0].code, 'ATM_CLI_USAGE');
    assert.deepEqual(snapshot(cwd), before);
    assert.deepEqual(governanceSnapshot(cwd), governance);
  }));
}

for (const args of [[], ['--claim'], ['--task', taskId]]) {
  test(`adoption requires claim and one explicit task: ${args.join(' ')}`, () => withFixture(cwd => {
    const governance = governanceSnapshot(cwd);
    const before = snapshot(cwd);
    const run = runAtm(cwd, ['next', '--actor', actor, '--adopt-unowned-wip', ...args]);
    assert.equal(run.status, 2, JSON.stringify(run.result));
    assert.equal(run.result.messages[0].code, 'ATM_CLI_USAGE');
    assert.deepEqual(governanceSnapshot(cwd), governance);
    assert.deepEqual(snapshot(cwd), before);
  }));
}

test('adoption does not grant stale-runner recovery authority', () => withFixture(cwd => {
  const before = snapshot(cwd);
  const run = claim(cwd, ['--adopt-unowned-wip', '--allow-stale-runner']);
  assert.equal(run.status, 1, JSON.stringify(run.result));
  assert.equal(run.result.messages[0].code, 'ATM_EMERGENCY_LANE_APPROVAL_REQUIRED');
  assert.equal(read(cwd, `.atm/history/tasks/${taskId}.json`).claim, undefined);
  assert.deepEqual(snapshot(cwd), before);
}));

test('runner recovery alone cannot imply adoption or consume its isolated fixture lease', () => withFixture(cwd => {
  // Synthetic authority exists only inside this disposable test repository.
  const { lease } = createEmergencyLease({ cwd, taskId, actorId: actor, permission: 'backend.runnerRecovery',
    approvedBy: 'fixture', approvalText: 'Synthetic approval for isolated regression only', reason: 'Test capability separation',
    surface: 'next --claim runner recovery', allowedFlags: ['--allow-stale-runner'], ttlMinutes: 5, maxUses: 1 });
  const before = snapshot(cwd);
  const run = claim(cwd, ['--allow-stale-runner', '--emergency-approval', lease.leaseId]);
  assert.equal(run.status, 1, JSON.stringify(run.result));
  assert.equal(run.result.messages[0].code, 'ATM_CLAIM_FOREIGN_UNSTAGED_WIP');
  assert.deepEqual(readEmergencyLease(cwd, lease.leaseId), lease);
  assert.deepEqual(snapshot(cwd), before);
}));

test('adoption keeps dirty closeout-only refusal', () => withFixture(cwd => {
  const before = snapshot(cwd);
  const run = runAtm(cwd, ['next', '--claim', '--task', taskId, '--actor', actor,
    '--adopt-unowned-wip', '--claim-intent', 'closeout-only']);
  assert.equal(run.status, 1, JSON.stringify(run.result));
  assert.equal(run.result.messages[0].code, 'ATM_CLAIM_INTENT_CONFLICT');
  assert.deepEqual(snapshot(cwd), before);
}));

const unknownOwnerCases: Array<[string, string | object | null]> = [
  ['malformed JSON', '{"private":"OWNER_CONTENT_MUST_NOT_LEAK",'],
  ['non-object JSON', 'null'],
  ['array JSON', '[]'],
  ['unreadable directory', null],
  ['active claim without actor', { status: 'running', claim: { state: 'active', files: [tracked] } }],
  ['active claim without files', { status: 'running', claim: { state: 'active', actorId: 'foreign' } }],
  ['active claim with invalid lane', { status: 'running', claim: { state: 'active', actorId: 'foreign', files: [tracked], laneSession: {} } }],
  ['claim without state', { status: 'running', claim: { actorId: 'foreign', files: [tracked] } }],
  ['array claim state', { status: 'running', claim: { state: ['active'], actorId: 'foreign', files: [tracked] } }],
  ['empty normalized claim scope', { status: 'running', claim: { state: 'active', actorId: 'foreign', files: ['./'] } }],
  ['empty normalized retained scope', { status: 'open', wipOwnership: { schemaId: 'atm.retainedWipOwnership.v1', taskId: 'TASK-UNKNOWN-OWNER', actorId: 'foreign', laneSessionId: 'fixture-lane', dirtyPaths: ['./'] } }],
  ['retention without ownership fields', { status: 'open', wipOwnership: { schemaId: 'atm.retainedWipOwnership.v1' } }],
  ['retention with mismatched task', { status: 'open', wipOwnership: { schemaId: 'atm.retainedWipOwnership.v1', taskId: 'OTHER', actorId: 'foreign', laneSessionId: 'fixture-lane', dirtyPaths: [tracked] } }]
];
for (const [label, value] of unknownOwnerCases) {
  test(`uncertain ownership fails closed during adoption: ${label}`, () => withFixture(cwd => {
    const ownerPath = '.atm/history/tasks/TASK-UNKNOWN-OWNER.json';
    if (value === null) mkdirSync(path.join(cwd, ownerPath), { recursive: true });
    else write(cwd, ownerPath, typeof value === 'string' ? value : { workItemId: 'TASK-UNKNOWN-OWNER', ...value });
    const before = snapshot(cwd);
    const taskBefore = hash(readFileSync(path.join(cwd, `.atm/history/tasks/${taskId}.json`)));
    const run = claim(cwd, ['--adopt-unowned-wip']);
    assert.equal(run.status, 1, JSON.stringify(run.result));
    assert.equal(run.result.messages[0].code, 'ATM_CLAIM_FOREIGN_UNSTAGED_WIP');
    assert.equal(run.result.messages[0].data.ownership, 'unknown');
    assert.ok(!JSON.stringify(run.result).includes('OWNER_CONTENT_MUST_NOT_LEAK'));
    assert.equal(hash(readFileSync(path.join(cwd, `.atm/history/tasks/${taskId}.json`))), taskBefore);
    assert.deepEqual(snapshot(cwd), before);
  }));
}

for (const status of ['done', 'abandoned']) {
  test(`terminal retained ownership remains inactive: ${status}`, () => withFixture(cwd => {
    write(cwd, '.atm/history/tasks/TASK-TERMINAL.json', { workItemId: 'TASK-TERMINAL', status, wipOwnership: {} });
    const before = snapshot(cwd);
    const run = claim(cwd, ['--adopt-unowned-wip']);
    assert.equal(run.status, 0, JSON.stringify(run.result));
    assert.deepEqual(snapshot(cwd), before);
  }));
}
