import assert from 'node:assert/strict';
import childProcess, { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { issueWorkAdmissionTicket } from '../../packages/core/src/broker/work-admission-ticket.ts';
import { resolveTaskScopedCommitBundle } from '../../packages/cli/src/commands/git-governance/implementation/commit-bundle-resolution.ts';
import { runWithSealedTaskScopedCommitIndex } from '../../packages/cli/src/commands/git-governance/implementation/sealed-commit-attribution.ts';
import { inspectCommitAttribution } from '../../packages/cli/src/commands/hook/pre-commit/support.ts';
import { runAtmGit } from '../../packages/cli/src/commands/git-governance.ts';
import { upsertActorWorkSession } from '../../packages/cli/src/commands/actor-session.ts';
import { writeRuntimeIdentityForActor } from '../../packages/cli/src/commands/actor-registry.ts';
import { runFrameworkTempClaim } from '../../packages/cli/src/commands/framework-development/closure-packet-schema/implementation.ts';

const registry = '.atm/catalog/registry/actors.json';
const actor = { actorId: 'isolation-actor', actorKind: 'ai-agent', displayName: 'Isolation Test', gitName: 'Isolation Test', gitEmail: 'isolation@example.invalid' };
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-attribution-isolation-'));
const oldEnv = { ...process.env };
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = (file: string, content: string) => { mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); writeFileSync(path.join(repo, file), content); };
const registryText = (extra: unknown[]) => JSON.stringify({ schemaId: 'atm.actorRegistry', specVersion: '0.1.0', actors: [actor, ...extra] }) + '\n';
try {
  delete process.env.ATM_LANE_SESSION_ID;
  git('init', '-q'); git('config', 'user.name', actor.gitName); git('config', 'user.email', actor.gitEmail);
  put('src/owned.ts', 'export const value = 1;\n'); put(registry, registryText([]));
  // A real 28k-entry index (>5 MiB) exercises every wrapper snapshot, including
  // preparation, failure rollback, retry and foreign partial-stage retention.
  for (let index = 0; index < 28_000; index += 1) put(`padding/${String(index).padStart(5, '0')}-${'x'.repeat(130)}.txt`, 'unchanged fixture\n');
  const now = new Date().toISOString();
  const taskId = 'TASK-ISOLATION';
  const task = {
    workItemId: taskId, status: 'running', scopePaths: ['src/owned.ts'],
    claim: { actorId: actor.actorId, leaseId: 'lease-isolation', claimedAt: now, heartbeatAt: now, ttlSeconds: 3600, files: ['src/owned.ts'], state: 'active' },
    workAdmissionTicket: issueWorkAdmissionTicket({ taskId, actorId: actor.actorId, claimGeneration: 'lease-isolation', allowedFiles: ['src/owned.ts'], runnerSelection: { runnerKind: 'frozen', runnerRef: 'test', selectedAt: now } }),
  };
  put(`.atm/history/tasks/${taskId}.json`, JSON.stringify(task));
  git('add', '.'); git('commit', '-qm', 'fixture');
  assert(Buffer.byteLength(git('ls-files', '--stage', '-z')) > 5 * 1024 * 1024);
  put(registry, registryText([{ actorId: 'foreign-staged', actorKind: 'ai-agent', displayName: 'Foreign' }])); git('add', '--', registry);
  put(registry, registryText([{ actorId: 'foreign-staged', actorKind: 'ai-agent', displayName: 'Foreign' }, { actorId: 'foreign-unstaged', actorKind: 'ai-agent', displayName: 'Foreign WIP' }]));
  put('src/owned.ts', 'export const value = 2;\n');
  const before = { head: git('rev-parse', `HEAD:${registry}`), index: git('ls-files', '--stage', '--', registry), worktree: readFileSync(path.join(repo, registry), 'utf8') };
  const input = { cwd: repo, taskId, actorId: actor.actorId, taskDocument: task, message: 'isolation', trailers: [], apply: false, autoStage: true, deferForeignStaged: true, stageOverrideLease: null, brokerConflictResolutionPath: null };
  const bundle = resolveTaskScopedCommitBundle(input);
  assert.equal(bundle.ok, true);
  assert(!bundle.commitFiles.includes(registry), 'foreign partially staged registry must not enter the commit');
  assert(!bundle.stageFiles.includes(registry), 'foreign registry must not enter staging');
  assert(!bundle.sealedBundle.entries.some((entry: { path: string }) => entry.path === registry), 'foreign registry must not enter sealed entries');
  assert.equal(bundle.deferredForeignStagedSnapshot, null, 'exclusion must not park the registry');
  assert.equal(git('ls-files', '--stage', '--', registry), before.index);
  assert.equal(readFileSync(path.join(repo, registry), 'utf8'), before.worktree);
  const bare = inspectCommitAttribution(repo, ['src/owned.ts']);
  assert.equal(bare.ok, false, 'bare attribution must keep the unstaged-registry guard');
  assert(bare.findings.some((finding: { code: string }) => finding.code === 'ATM_COMMIT_ACTOR_REGISTRY_UNSTAGED'));
  // Exercise the actual sealed-index execution boundary, including hook
  // attribution, failure rollback, and post-success live-index reconciliation.
  const execute = (fail: boolean) => runWithSealedTaskScopedCommitIndex({
    cwd: repo, paths: bundle.commitFiles, actorId: actor.actorId, taskId, provenance: 'task-scope', surface: 'isolation regression',
    sealSource: { kind: 'sealed-bundle', bundle: bundle.sealedBundle },
    run: (env) => {
      Object.assign(process.env, env, { ATM_COMMIT_ACTOR_ID: actor.actorId, ATM_COMMIT_TASK_ID: taskId, GIT_AUTHOR_NAME: actor.gitName, GIT_AUTHOR_EMAIL: actor.gitEmail });
      // A bound session is still required by the existing hook; this fixture
      // asks the attribution dependency decision independently below.
      const result = inspectCommitAttribution(repo, ['src/owned.ts']);
      assert(!result.findings.some((finding: { code: string }) => finding.code === 'ATM_COMMIT_ACTOR_REGISTRY_UNSTAGED'), 'candidate exclusion must not be mistaken for unstaged attribution');
      for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
      Object.assign(process.env, oldEnv); delete process.env.ATM_LANE_SESSION_ID;
      if (fail) throw new Error('simulated signing failure');
      execFileSync('git', ['commit', '-qm', 'isolated source'], { cwd: repo, env, stdio: 'pipe' });
    },
  });
  assert.throws(() => execute(true), /simulated signing failure/);
  assert.equal(git('ls-files', '--stage', '--', registry), before.index);
  assert.equal(readFileSync(path.join(repo, registry), 'utf8'), before.worktree);
  execute(false);
  assert.equal(git('rev-parse', `HEAD:${registry}`), before.head);
  assert.equal(git('ls-files', '--stage', '--', registry), before.index);
  assert.equal(readFileSync(path.join(repo, registry), 'utf8'), before.worktree);
  assert.equal(git('show', 'HEAD:src/owned.ts'), 'export const value = 2;');
  put('.atm/config.json', JSON.stringify({ schemaVersion: 'atm.config.v0.1', layoutVersion: 2, paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' }, taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' } }));
  upsertActorWorkSession({ cwd: repo, actorId: actor.actorId, taskId, claimLeaseId: task.claim.leaseId, gitName: actor.gitName, gitEmail: actor.gitEmail });
  writeRuntimeIdentityForActor(repo, actor.actorId, { schemaId: 'atm.identityDefault.v1', specVersion: '0.1.0', actorId: actor.actorId, gitName: actor.gitName, gitEmail: actor.gitEmail, updatedAt: now });
  const hookModule = new URL('../../packages/cli/src/commands/hook/pre-commit/support.ts', import.meta.url).href;
  put('.git/attribution-hook.mjs', `import { inspectCommitAttribution } from ${JSON.stringify(hookModule)};
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const files = execFileSync('git', ['diff','--cached','--name-only'], { encoding: 'utf8' }).trim().split('\\n').filter(Boolean);
const result = inspectCommitAttribution(process.cwd(), files);
if (!result.ok) { console.error(JSON.stringify(result)); process.exit(1); }
if (process.env.ATM_TEST_FOREIGN_STAGING_ON_FAILURE === '1') {
  const env = { ...process.env }; delete env.GIT_INDEX_FILE;
  const registry = ${JSON.stringify(registry)};
  const doc = JSON.parse(readFileSync(registry, 'utf8')); doc.actors.push({ actorId: 'concurrent-staged', actorKind: 'ai-agent', displayName: 'Concurrent' });
  writeFileSync(registry, JSON.stringify(doc));
  execFileSync('git', ['add','--',registry], { env });
  writeFileSync('.git/expected-foreign-index', execFileSync('git', ['ls-files','--stage','--',registry], { env }));
  doc.actors.push({ actorId: 'concurrent-unstaged', actorKind: 'ai-agent', displayName: 'Concurrent WIP' }); writeFileSync(registry, JSON.stringify(doc));
  writeFileSync('.git/expected-foreign-worktree', readFileSync(registry));
  process.exit(1);
}
`);
  put('.git/hooks/pre-commit', `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} --strip-types .git/attribution-hook.mjs\n`);
  chmodSync(path.join(repo, '.git/hooks/pre-commit'), 0o755);
  put('src/owned.ts', 'export const value = 3;\n');
  const wrapper = ['commit', '--cwd', repo, '--actor', actor.actorId, '--task', taskId, '--message', 'wrapper isolation', '--auto-stage', '--defer-foreign-staged', '--json'];
  const beforeMalformed = { head: git('rev-parse', 'HEAD'), index: git('ls-files', '--stage', '-z'), registry: readFileSync(path.join(repo, registry), 'utf8') };
  const originalExec = childProcess.execFileSync;
  try {
    childProcess.execFileSync = ((executable, args, options) => {
      if (Array.isArray(args) && args.includes('ls-files') && args.includes('-z') && args.includes('--stage')) return Buffer.from('100644 ' + 'a'.repeat(40) + ' 0\tvalid\0truncated');
      return originalExec(executable, args as readonly string[], options);
    }) as typeof execFileSync;
    syncBuiltinESMExports();
    await assert.rejects(() => runAtmGit(wrapper), (error: any) => error.code === 'ATM_GIT_COMMIT_FAILED' && error.details.nestedFailure.boundary === 'index-snapshot');
  } finally { childProcess.execFileSync = originalExec; syncBuiltinESMExports(); }
  assert.equal(git('rev-parse', 'HEAD'), beforeMalformed.head);
  assert.equal(git('ls-files', '--stage', '-z'), beforeMalformed.index);
  assert.equal(readFileSync(path.join(repo, registry), 'utf8'), beforeMalformed.registry);
  const success = await runAtmGit(wrapper);
  assert.equal(success.ok, true, 'real wrapper commit with successful bound-session Git attribution hook');
  assert.equal(git('rev-parse', `HEAD:${registry}`), before.head);
  assert.equal(git('ls-files', '--stage', '--', registry), before.index);
  const emptyIndexEntries = git('ls-files', '--stage');
  const emptyPreview = await runAtmGit([...wrapper, '--dry-run']);
  assert.equal(emptyPreview.ok, false, 'empty task preview fails before foreign-index fallback');
  await assert.rejects(() => runAtmGit(wrapper), (error: any) => error.code === 'ATM_GIT_COMMIT_BUNDLE_BLOCKED');
  assert.equal(git('ls-files', '--stage'), emptyIndexEntries, 'empty preview/apply must leave every shared-index blob, mode and stage unchanged');
  put('src/owned.ts', 'export const value = 4;\n');
  const failureHead = git('rev-parse', 'HEAD');
  process.env.ATM_TEST_FOREIGN_STAGING_ON_FAILURE = '1';
  await assert.rejects(() => runAtmGit(wrapper), (error: any) => error.code === 'ATM_GIT_COMMIT_FAILED');
  delete process.env.ATM_TEST_FOREIGN_STAGING_ON_FAILURE;
  assert.equal(git('rev-parse', 'HEAD'), failureHead);
  assert.equal(git('ls-files', '--stage', '--', registry), readFileSync(path.join(repo, '.git/expected-foreign-index'), 'utf8').trim(), 'outer wrapper rollback must preserve concurrently changed foreign staging');
  assert.equal(readFileSync(path.join(repo, registry), 'utf8'), readFileSync(path.join(repo, '.git/expected-foreign-worktree'), 'utf8'));
  assert.equal((await runAtmGit(wrapper)).ok, true, 'retry commits source while retaining concurrent registry state');
  const frameworkActor = 'framework-isolation';
  writeRuntimeIdentityForActor(repo, frameworkActor, { schemaId: 'atm.identityDefault.v1', specVersion: '0.1.0', actorId: frameworkActor, gitName: 'Framework Isolation', gitEmail: 'framework@example.invalid', updatedAt: now });
  put('src/framework-owned.ts', 'export const framework = true;\n');
  assert.equal((await runFrameworkTempClaim(repo, frameworkActor, ['src/framework-owned.ts'], 'attribution isolation fixture')).ok, true);
  const frameworkCommand = ['commit', '--cwd', repo, '--actor', frameworkActor, '--message', 'framework isolated source', '--auto-stage', '--defer-foreign-staged', '--json'];
  const frameworkIndex = git('ls-files', '--stage', '--', registry);
  const frameworkBytes = readFileSync(path.join(repo, registry), 'utf8');
  assert.equal((await runAtmGit([...frameworkCommand, '--dry-run'])).ok, true);
  assert.equal(git('ls-files', '--stage', '--', registry), frameworkIndex);
  assert.equal((await runAtmGit(frameworkCommand)).ok, true, 'taskless framework selection, preparation and actual hook preserve foreign registry');
  assert.equal(git('ls-files', '--stage', '--', registry), frameworkIndex);
  assert.equal(readFileSync(path.join(repo, registry), 'utf8'), frameworkBytes);
  const frameworkEmptyIndex = git('ls-files', '--stage');
  await assert.rejects(() => runAtmGit([...frameworkCommand, '--dry-run']), (error: any) => error.code === 'ATM_GIT_COMMIT_BUNDLE_BLOCKED');
  await assert.rejects(() => runAtmGit(frameworkCommand), (error: any) => error.code === 'ATM_GIT_COMMIT_BUNDLE_BLOCKED');
  assert.equal(git('ls-files', '--stage'), frameworkEmptyIndex, 'empty framework candidate must remain empty in preview and apply');
  // Explicit whole-file authority does not permit a worktree-derived author
  // to silently replace the selected partially staged actor identity.
  task.scopePaths.push(registry); task.claim.files.push(registry);
  task.workAdmissionTicket = issueWorkAdmissionTicket({ taskId, actorId: actor.actorId, claimGeneration: task.claim.leaseId, allowedFiles: task.claim.files, runnerSelection: { runnerKind: 'frozen', runnerRef: 'fixture', selectedAt: now } });
  put(`.atm/history/tasks/${taskId}.json`, JSON.stringify(task));
  const stagedIdentity = { ...actor, gitName: 'Staged Identity' };
  put(registry, JSON.stringify({ actors: [stagedIdentity] })); git('add', '--', registry);
  const worktreeIdentityBytes = JSON.stringify({ actors: [{ ...actor, gitName: 'Newer Worktree Identity' }] });
  put(registry, worktreeIdentityBytes); put('src/owned.ts', 'export const value = 5;\n'); git('add', '--', 'src/owned.ts');
  const manualCommand = wrapper.filter((arg) => arg !== '--auto-stage');
  const manualIndex = git('ls-files', '--stage');
  await assert.rejects(() => runAtmGit([...manualCommand, '--dry-run']), (error: any) => error.code === 'ATM_COMMIT_AUTHOR_NAME_MISMATCH');
  await assert.rejects(() => runAtmGit(manualCommand), (error: any) => error.code === 'ATM_COMMIT_AUTHOR_NAME_MISMATCH');
  assert.equal(git('ls-files', '--stage'), manualIndex);
  writeRuntimeIdentityForActor(repo, actor.actorId, { schemaId: 'atm.identityDefault.v1', specVersion: '0.1.0', actorId: actor.actorId, gitName: stagedIdentity.gitName, gitEmail: actor.gitEmail, updatedAt: now });
  assert.equal((await runAtmGit([...manualCommand, '--dry-run'])).ok, true);
  assert.equal((await runAtmGit(manualCommand)).ok, true, 'manual staged candidate succeeds once author attribution matches its selected identity');
  assert.equal(git('show', '-s', '--format=%an', 'HEAD'), stagedIdentity.gitName);
  assert.equal(JSON.parse(git('show', `HEAD:${registry}`)).actors[0].gitName, stagedIdentity.gitName);
  assert.equal(readFileSync(path.join(repo, registry), 'utf8'), worktreeIdentityBytes, 'manual-staged commit leaves newer worktree identity untouched');
  console.log('git-commit-attribution-isolation: partial-stage exclusion, hook parity, rollback and commit preservation passed');
} finally {
  for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
  Object.assign(process.env, oldEnv); rmSync(repo, { recursive: true, force: true });
}
