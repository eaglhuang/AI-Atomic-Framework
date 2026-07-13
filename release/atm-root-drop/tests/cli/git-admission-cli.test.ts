import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAtmGit } from '../../packages/cli/src/commands/git-governance.ts';
import { gitBoundaryFixtures } from '../../scripts/lib/git-boundary-fixtures.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = path.resolve(root, '.atm-temp-test-git-admission-cli');

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function writeText(filePath: string, content: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function setupRemoteScenario(name: string) {
  const scenarioRoot = path.join(tempRoot, name);
  const seed = path.join(scenarioRoot, 'seed');
  const remote = path.join(scenarioRoot, 'remote.git');
  const local = path.join(scenarioRoot, 'local');
  rmSync(scenarioRoot, { recursive: true, force: true });
  mkdirSync(seed, { recursive: true });
  runGit(seed, ['init', '--initial-branch=main']);
  runGit(seed, ['config', 'user.name', 'fixture-agent']);
  runGit(seed, ['config', 'user.email', 'fixture-agent@example.com']);
  writeText(path.join(seed, 'README.md'), '# fixture\n');
  runGit(seed, ['add', 'README.md']);
  runGit(seed, ['commit', '-m', 'chore: bootstrap']);
  runGit(seed, ['clone', '--bare', seed, remote]);
  runGit(seed, ['remote', 'add', 'origin', remote]);
  runGit(seed, ['push', '-u', 'origin', 'main']);
  runGit(scenarioRoot, ['clone', remote, local]);
  runGit(local, ['config', 'user.name', 'fixture-agent']);
  runGit(local, ['config', 'user.email', 'fixture-agent@example.com']);
  return { scenarioRoot, seed, remote, local };
}

function commitAndPush(cwd: string, message: string, files: Record<string, string>) {
  for (const [relativePath, content] of Object.entries(files)) {
    writeText(path.join(cwd, relativePath), content);
  }
  runGit(cwd, ['add', '--', ...Object.keys(files)]);
  runGit(cwd, ['commit', '-m', message]);
  runGit(cwd, ['push', 'origin', 'main']);
}

async function runAdmission(local: string, extraArgs: string[] = []) {
  return runAtmGit([
    'admit',
    '--cwd', local,
    '--actor', 'fixture-agent',
    '--branch', 'main',
    '--remote', 'origin',
    '--no-fetch',
    ...extraArgs,
    '--json'
  ]);
}

async function runPush(local: string, extraArgs: string[] = []) {
  return runAtmGit([
    'push',
    '--cwd', local,
    '--actor', 'fixture-agent',
    '--branch', 'main',
    '--remote', 'origin',
    ...extraArgs,
    '--json'
  ]);
}

async function runPostPushFailRecovery(local: string, extraArgs: string[] = []) {
  return runAtmGit([
    'recover-push-fail',
    '--cwd', local,
    '--actor', 'fixture-agent',
    '--branch', 'main',
    '--remote', 'origin',
    ...extraArgs,
    '--json'
  ]);
}

function remoteHead(remote: string) {
  return runGit(path.dirname(remote), ['ls-remote', remote, 'refs/heads/main']).split(/\s+/)[0] ?? '';
}

try {
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });

  {
    const { seed, local } = setupRemoteScenario('allow');
    commitAndPush(seed, 'feat: remote file', {
      'remote-only.txt': gitBoundaryFixtures.allow.remoteOnly
    });
    runGit(local, ['fetch', 'origin', 'main']);
    writeText(path.join(local, 'local-only.txt'), gitBoundaryFixtures.allow.localOnly);
    runGit(local, ['add', 'local-only.txt']);
    runGit(local, ['commit', '-m', 'feat: local file']);
    const result = await runAdmission(local);
    assert.equal(result.ok, true);
    assert.equal((result.evidence as any).outcome, 'allow');
    assert.deepEqual((result.evidence as any).conflictingFiles, []);
  }

  {
    const { local } = setupRemoteScenario('no-op');
    const result = await runAdmission(local);
    assert.equal(result.ok, true);
    assert.equal((result.evidence as any).outcome, 'no-op');
  }

  {
    const { remote, local } = setupRemoteScenario('push-wrapper');
    const beforeRemote = remoteHead(remote);
    writeText(path.join(local, 'pushed-by-wrapper.txt'), 'governed push\n');
    runGit(local, ['add', 'pushed-by-wrapper.txt']);
    runGit(local, ['commit', '-m', 'feat: governed push wrapper']);
    const localHead = runGit(local, ['rev-parse', 'HEAD']);

    const dryRun = await runPush(local, ['--dry-run']);
    assert.equal(dryRun.ok, true);
    assert.equal((dryRun.evidence as any).action, 'push');
    assert.equal((dryRun.evidence as any).dryRun, true);
    assert.equal((dryRun.evidence as any).hostPush, null);
    assert.equal(remoteHead(remote), beforeRemote, 'dry-run must not mutate the remote branch');

    const pushed = await runPush(local);
    assert.equal(pushed.ok, true);
    assert.equal((pushed.evidence as any).action, 'push');
    assert.equal((pushed.evidence as any).hostPush?.exitCode, 0);
    assert.equal(remoteHead(remote), localHead, 'governed push must publish local HEAD to the remote branch');
  }

  {
    const { seed, local } = setupRemoteScenario('block');
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.blockBase);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: add data']);
    runGit(seed, ['push', 'origin', 'main']);

    runGit(local, ['pull', '--ff-only', 'origin', 'main']);
    cpSync(path.join(local, 'data.json'), path.join(seed, 'data.json'));

    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.blockRemote);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: remote alpha']);
    runGit(seed, ['push', 'origin', 'main']);

    runGit(local, ['fetch', 'origin', 'main']);
    writeText(path.join(local, 'data.json'), gitBoundaryFixtures.json.blockLocal);
    runGit(local, ['add', 'data.json']);
    runGit(local, ['commit', '-m', 'feat: local alpha']);

    const result = await runAdmission(local);
    assert.equal(result.ok, false);
    assert.equal((result.evidence as any).outcome, 'block');
    assert.deepEqual((result.evidence as any).conflictingFiles, ['data.json']);
  }

  {
    const { seed, remote, local } = setupRemoteScenario('push-wrapper-block');
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.blockBase);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: add data']);
    runGit(seed, ['push', 'origin', 'main']);

    runGit(local, ['pull', '--ff-only', 'origin', 'main']);
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.blockRemote);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: remote alpha']);
    runGit(seed, ['push', 'origin', 'main']);
    const remoteAfterDrift = remoteHead(remote);

    runGit(local, ['fetch', 'origin', 'main']);
    writeText(path.join(local, 'data.json'), gitBoundaryFixtures.json.blockLocal);
    runGit(local, ['add', 'data.json']);
    runGit(local, ['commit', '-m', 'feat: local alpha']);

    const blocked = await runPush(local);
    assert.equal(blocked.ok, false);
    assert.equal((blocked.evidence as any).action, 'push');
    assert.equal((blocked.evidence as any).hostPush, null);
    assert.equal((blocked.evidence as any).admission.outcome, 'block');
    assert.deepEqual((blocked.evidence as any).admission.conflictingFiles, ['data.json']);
    assert.equal(remoteHead(remote), remoteAfterDrift, 'blocked governed push must not call host git push');
  }

  {
    const { seed, local } = setupRemoteScenario('composer');
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.composerBase);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: add data']);
    runGit(seed, ['push', 'origin', 'main']);

    runGit(local, ['pull', '--ff-only', 'origin', 'main']);
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.composerRemote);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: remote alpha']);
    runGit(seed, ['push', 'origin', 'main']);

    runGit(local, ['fetch', 'origin', 'main']);
    writeText(path.join(local, 'data.json'), gitBoundaryFixtures.json.composerLocal);
    runGit(local, ['add', 'data.json']);
    runGit(local, ['commit', '-m', 'feat: local beta']);

    const result = await runAdmission(local);
    assert.equal(result.ok, false);
    assert.equal((result.evidence as any).outcome, 'composer-routed');
    assert.deepEqual((result.evidence as any).conflictingFiles, ['data.json']);

    const beforeHead = runGit(local, ['rev-parse', 'HEAD']);
    const beforeContent = runGit(local, ['show', 'HEAD:data.json']);

    const dryRun = await runAdmission(local, ['--steward-plan']);
    assert.equal(dryRun.ok, true);
    assert.equal((dryRun.evidence as any).outcome, 'composer-routed');
    assert.equal((dryRun.evidence as any).steward?.mode, 'steward-plan');
    assert.equal((dryRun.evidence as any).steward?.applyEvidence, null);
    assert.equal(runGit(local, ['rev-parse', 'HEAD']), beforeHead);
    assert.equal(runGit(local, ['show', 'HEAD:data.json']), beforeContent);

    const apply = await runAdmission(local, ['--apply-to-working-tree']);
    assert.equal(apply.ok, true);
    assert.equal((apply.evidence as any).outcome, 'composer-routed');
    assert.equal((apply.evidence as any).steward?.mode, 'apply-to-working-tree');
    assert.equal(runGit(local, ['rev-parse', 'HEAD']), beforeHead);
    assert.equal(
      runGit(local, ['show', 'HEAD:data.json']),
      beforeContent,
      'apply-to-working-tree must not create an automatic commit'
    );
    const appliedContent = readFileSync(path.join(local, 'data.json'), 'utf8');
    assert.match(appliedContent, /\"alpha\": 2/);
    assert.match(appliedContent, /\"beta\": 2/);
  }

  {
    const { seed, local } = setupRemoteScenario('recover-block');
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.blockBase);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: add data']);
    runGit(seed, ['push', 'origin', 'main']);

    runGit(local, ['pull', '--ff-only', 'origin', 'main']);
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.blockRemote);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: remote alpha']);
    runGit(seed, ['push', 'origin', 'main']);

    writeText(path.join(local, 'data.json'), gitBoundaryFixtures.json.blockLocal);
    runGit(local, ['add', 'data.json']);
    runGit(local, ['commit', '-m', 'feat: local alpha']);

    let rejected = '';
    try {
      runGit(local, ['push', 'origin', 'main']);
      assert.fail('push must be rejected when remote advanced first');
    } catch (error) {
      rejected = String((error as { stderr?: string }).stderr ?? error);
    }
    assert.match(rejected, /rejected|fetch first|non-fast-forward/i);

    const recovery = await runPostPushFailRecovery(local);
    assert.equal(recovery.ok, false);
    assert.equal((recovery.evidence as any).action, 'recover-push-fail');
    assert.equal((recovery.evidence as any).outcome, 'block');
    assert.equal((recovery.evidence as any).recovery?.mode, 'post-push-fail');
    assert.equal((recovery.evidence as any).recovery?.fetched, true);
    assert.equal((recovery.evidence as any).recovery?.likelyNonFastForward, true);
    assert.equal((recovery.evidence as any).recovery?.recoveryKind, 'rebase');
    assert.match(String((recovery.evidence as any).recommendedNextStep), /rebase/i);
  }

  {
    const { seed, local } = setupRemoteScenario('recover-composer');
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.composerBase);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: add data']);
    runGit(seed, ['push', 'origin', 'main']);

    runGit(local, ['pull', '--ff-only', 'origin', 'main']);
    writeText(path.join(seed, 'data.json'), gitBoundaryFixtures.json.composerRemote);
    runGit(seed, ['add', 'data.json']);
    runGit(seed, ['commit', '-m', 'feat: remote alpha']);
    runGit(seed, ['push', 'origin', 'main']);

    writeText(path.join(local, 'data.json'), gitBoundaryFixtures.json.composerLocal);
    runGit(local, ['add', 'data.json']);
    runGit(local, ['commit', '-m', 'feat: local beta']);

    let rejected = '';
    try {
      runGit(local, ['push', 'origin', 'main']);
      assert.fail('push must be rejected when remote advanced first');
    } catch (error) {
      rejected = String((error as { stderr?: string }).stderr ?? error);
    }
    assert.match(rejected, /rejected|fetch first|non-fast-forward/i);

    const recovery = await runPostPushFailRecovery(local);
    assert.equal(recovery.ok, true);
    assert.equal((recovery.evidence as any).action, 'recover-push-fail');
    assert.equal((recovery.evidence as any).outcome, 'composer-routed');
    assert.equal((recovery.evidence as any).recovery?.mode, 'post-push-fail');
    assert.equal((recovery.evidence as any).recovery?.fetched, true);
    assert.equal((recovery.evidence as any).recovery?.recoveryKind, 'steward-apply');
    assert.match(String((recovery.evidence as any).recommendedNextStep), /steward-plan|apply-to-working-tree/i);
  }

  console.log('[git-admission-cli] ok');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
