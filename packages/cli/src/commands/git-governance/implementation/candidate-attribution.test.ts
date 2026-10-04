import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { issueWorkAdmissionTicket } from '../../../../../core/src/broker/work-admission-ticket.ts';
import { mintLaneSession } from '../../lane-session/store.ts';
import { upsertActorWorkSession } from '../../actor-session.ts';
import { writeRuntimeIdentityForActor } from '../../actor-registry.ts';
import { inspectCommitAttribution } from '../../hook/pre-commit/support.ts';
import { resolveCandidateAttribution, resolveCandidateAttributionAuthority } from './candidate-attribution.ts';
import { resolveTaskScopedCommitBundle } from './commit-bundle-resolution.ts';
import { runWithSealedTaskScopedCommitIndex } from './sealed-commit-attribution.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-candidate-attribution-'));
const savedEnv = { ...process.env };
const registry = '.atm/catalog/registry/actors.json';
const actor = { actorId: 'actor-a', actorKind: 'ai-agent', displayName: 'Actor A', gitName: 'Actor A', gitEmail: 'a@example.invalid', editor: 'codex', provider: 'openai' };
const taskId = 'TASK-ATTRIBUTION';
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = (file: string, value: unknown) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value)); };
const actorDoc = (actors: unknown[]) => ({ schemaId: 'atm.actorRegistry', specVersion: '0.1.0', actors });
const now = new Date().toISOString();
const taskPath = `.atm/history/tasks/${taskId}.json`;
let task: any;
function authority(files = ['src/owned.ts'], actorId = actor.actorId, laneSessionId: string | null = null) {
  task = { workItemId: taskId, status: 'running', scopePaths: files, taskDirectionLock: { allowedFiles: files },
    claim: { actorId, leaseId: 'lease-a', claimedAt: now, heartbeatAt: now, ttlSeconds: 3600, files, state: 'active',
      ...(laneSessionId ? { laneSession: { laneSessionId, status: 'active', source: 'minted', exportHint: 'fixture' } } : {}) },
    workAdmissionTicket: issueWorkAdmissionTicket({ taskId, actorId, laneSessionId, claimGeneration: 'lease-a', allowedFiles: files, runnerSelection: { runnerKind: 'frozen', runnerRef: 'fixture', selectedAt: now } }),
  }; put(taskPath, task);
}
const select = (autoStage = true, actorId = actor.actorId) => resolveCandidateAttribution({ cwd: root, taskId, actorId, phase: 'selection', autoStage });
const allowRegistry = () => resolveCandidateAttributionAuthority({ cwd: root, taskId, actorId: actor.actorId }, [registry]);
try {
  delete process.env.ATM_LANE_SESSION_ID;
  delete process.env.ATM_COMMIT_LANE_SESSION_ID;
  git('init', '-q'); git('config', 'user.name', actor.gitName); git('config', 'user.email', actor.gitEmail);
  authority();
  writeRuntimeIdentityForActor(root, actor.actorId, { schemaId: 'atm.identityDefault.v1', specVersion: '0.1.0', actorId: actor.actorId, gitName: actor.gitName, gitEmail: actor.gitEmail, updatedAt: now });
  assert.equal(select().ok, true, 'verified unborn HEAD with no registry supports an independently authorized actor-local identity');
  upsertActorWorkSession({ cwd: root, actorId: actor.actorId, taskId, claimLeaseId: 'lease-a' });
  Object.assign(process.env, { ATM_COMMIT_ACTOR_ID: actor.actorId, ATM_COMMIT_TASK_ID: taskId, GIT_AUTHOR_NAME: actor.gitName, GIT_AUTHOR_EMAIL: actor.gitEmail });
  assert.equal(inspectCommitAttribution(root, ['src/owned.ts']).ok, true, 'absent registry must not substitute a null identity');
  put(registry, actorDoc([actor])); put('src/owned.ts', 'export const value = 1;\n'); authority();
  git('add', '.'); git('commit', '-qm', 'fixture');
  const headRegistry = git('rev-parse', `HEAD:${registry}`);
  put(registry, actorDoc([actor, { ...actor, actorId: 'foreign' }])); git('add', '--', registry);
  put(registry, actorDoc([actor, { ...actor, actorId: 'foreign' }, { ...actor, actorId: 'foreign-wip' }]));
  assert.equal(select().ok, true); assert.equal(select().registryAllowed, false);
  const staged = git('rev-parse', `:${registry}`);
  const worktree = readFileSync(path.join(root, registry), 'utf8');
  const emptyCandidate = resolveTaskScopedCommitBundle({ cwd: root, taskId, actorId: actor.actorId, taskDocument: task, autoStage: true, apply: false, deferForeignStaged: true, message: 'empty fixture', trailers: [] });
  assert.equal(emptyCandidate.ok, false, 'registry-only state cannot make an empty task candidate ready');
  assert.equal(emptyCandidate.blockedCode, 'ATM_GIT_COMMIT_BUNDLE_BLOCKED');
  for (const deferForeignStaged of [false, true]) for (const autoStage of [false, true]) for (const apply of [false, true]) {
    const bundle = resolveTaskScopedCommitBundle({ cwd: root, taskId, actorId: actor.actorId, taskDocument: task, autoStage, apply, deferForeignStaged, message: 'fixture', trailers: [] });
    assert(!bundle.commitFiles.includes(registry)); assert(!bundle.stageFiles.includes(registry));
    assert(!bundle.sealedBundle.entries.some((entry: any) => entry.path === registry));
    assert.equal(git('rev-parse', `:${registry}`), staged); assert.equal(readFileSync(path.join(root, registry), 'utf8'), worktree);
  }
  authority(['src/owned.ts', registry]);
  assert.equal(allowRegistry().ok, true);
  // Canonical ticket and live claim are both required. Planning, row labels,
  // and a foreign index lease are not whole-file publication authority.
  for (const mutate of [
    () => { delete task.workAdmissionTicket; },
    () => { task.workAdmissionTicket.actorId = 'actor-b'; },
    () => { task.workAdmissionTicket.claimGeneration = 'old-generation'; },
    () => { task.workAdmissionTicket.expiresAt = '2000-01-01T00:00:00Z'; },
    () => { task.workAdmissionTicket.expiresAt = 'invalid'; },
    () => { task.workAdmissionTicket.grants.find((grant: any) => grant.kind === 'file-write').values = ['src/owned.ts']; },
    () => { task.claim.state = 'released'; },
    () => { task.claim.heartbeatAt = 'invalid'; },
    () => { task.claim.heartbeatAt = '2000-01-01T00:00:00Z'; },
    () => { task.claim.files = ['src/owned.ts']; },
  ]) { authority(['src/owned.ts', registry]); mutate(); put(taskPath, task); assert.equal(allowRegistry().ok, false); }
  authority(['src/owned.ts', registry]);
  put(registry, actorDoc([{ ...actor, gitName: 'Unstaged Name' }]));
  assert.equal(select(false).identity?.gitName, actor.gitName, 'manual staging uses exact index blob');
  assert.equal(select(true).identity?.gitName, 'Unstaged Name', 'authorized auto-stage uses exact worktree blob');
  assert.equal(resolveCandidateAttribution({ cwd: root, taskId, actorId: actor.actorId, phase: 'selection', autoStage: true, candidateFiles: [] }).ok, false, 'a closed slice excluding registry cannot depend on its changed identity');
  const manual = resolveTaskScopedCommitBundle({ cwd: root, taskId, actorId: actor.actorId, taskDocument: task, autoStage: false, apply: false, message: 'fixture', trailers: [] });
  assert.equal(manual.sealedBundle.entries.find((entry: any) => entry.path === registry)?.blobId, staged);
  put(registry, actorDoc([]));
  writeRuntimeIdentityForActor(root, actor.actorId, { schemaId: 'atm.identityDefault.v1', specVersion: '0.1.0', actorId: actor.actorId, gitName: 'Replayed identity', gitEmail: 'replayed@example.invalid', updatedAt: now });
  assert.equal(select(true).ok, false, 'authorized removal of a persisted actor cannot activate runtime-only fallback');
  put(registry, actorDoc([{ ...actor, gitName: 'Unstaged Name' }]));
  authority();
  assert.equal(select().ok, false, 'excluded changed current actor identity must fail');
  put(registry, actorDoc([actor, { ...actor, actorId: 'foreign' }]));
  const lane = mintLaneSession({ cwd: root, actorId: actor.actorId, taskId, ttlMs: 60000 }).session;
  authority(['src/owned.ts', registry], actor.actorId, lane.laneId);
  assert.equal(allowRegistry().ok, false, 'a borrowed actor string is not the lane capability');
  process.env.ATM_LANE_SESSION_ID = lane.laneId;
  assert.equal(allowRegistry().ok, true);
  const otherLane = mintLaneSession({ cwd: root, actorId: 'actor-b', taskId, ttlMs: 60000 }).session;
  process.env.ATM_LANE_SESSION_ID = otherLane.laneId;
  assert.equal(allowRegistry().ok, false);
  process.env.ATM_LANE_SESSION_ID = lane.laneId;
  put(`.atm/runtime/lane-sessions/${lane.laneId}.json`, { ...lane, status: 'released' });
  assert.equal(allowRegistry().ok, false);
  delete process.env.ATM_LANE_SESSION_ID;
  authority();
  // Actual hook attribution: environment labels cannot create authority.
  process.env.ATM_COMMIT_ACTOR_ID = actor.actorId; process.env.ATM_COMMIT_TASK_ID = taskId;
  process.env.GIT_AUTHOR_NAME = actor.gitName; process.env.GIT_AUTHOR_EMAIL = actor.gitEmail;
  upsertActorWorkSession({ cwd: root, actorId: actor.actorId, taskId, claimLeaseId: 'lease-a' });
  put('src/owned.ts', 'export const value = 2;\n');
  const bundle = resolveTaskScopedCommitBundle({ cwd: root, taskId, actorId: actor.actorId, taskDocument: task, autoStage: true, apply: false, message: 'fixture', trailers: [] });
  runWithSealedTaskScopedCommitIndex({ cwd: root, paths: bundle.commitFiles, actorId: actor.actorId, taskId, provenance: 'task-scope', surface: 'hook identity proof', sealSource: { kind: 'sealed-bundle', bundle: bundle.sealedBundle }, run: (env) => {
    process.env.GIT_INDEX_FILE = env.GIT_INDEX_FILE;
    assert.equal(inspectCommitAttribution(root, ['src/owned.ts']).ok, true);
    process.env.GIT_AUTHOR_EMAIL = 'spoof@example.invalid';
    assert.equal(inspectCommitAttribution(root, ['src/owned.ts']).ok, false);
    process.env.GIT_AUTHOR_EMAIL = actor.gitEmail;
    const original = task.workAdmissionTicket; delete task.workAdmissionTicket; put(taskPath, task);
    assert.equal(inspectCommitAttribution(root, ['src/owned.ts']).ok, false, 'spoofed wrapper environment does not waive missing authority');
    task.workAdmissionTicket = original; put(taskPath, task); delete process.env.GIT_INDEX_FILE;
    execFileSync('git', ['commit', '-qm', 'candidate'], { cwd: root, env, stdio: 'pipe' });
  } });
  assert.equal(git('rev-parse', `HEAD:${registry}`), headRegistry);
  // Supported runtime-only actors must be absent from both registry versions,
  // and the embedded actor id must match the profile path and live authority.
  const runtimeActor = 'runtime-only'; authority(['src/owned.ts'], runtimeActor);
  writeRuntimeIdentityForActor(root, runtimeActor, { schemaId: 'atm.identityDefault.v1', specVersion: '0.1.0', actorId: runtimeActor, gitName: 'Runtime Actor', gitEmail: 'runtime@example.invalid', updatedAt: now });
  assert.equal(select(true, runtimeActor).ok, true);
  writeRuntimeIdentityForActor(root, runtimeActor, { schemaId: 'atm.identityDefault.v1', specVersion: '0.1.0', actorId: 'foreign', gitName: 'Runtime Actor', gitEmail: 'runtime@example.invalid', updatedAt: now });
  assert.equal(select(true, runtimeActor).ok, false, 'profile replay from another actor fails');
  put(registry, '{malformed'); assert.equal(select(true, runtimeActor).ok, false);
  put(registry, actorDoc([actor])); git('rm', '-f', '--cached', '--', registry);
  assert.equal(select().registryChanged, true, 'staged deletion cannot masquerade as untracked');
  console.log('candidate-attribution: authority, partial staging, runtime identity and hook negative matrix passed');
} finally {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv); rmSync(root, { recursive: true, force: true });
}
