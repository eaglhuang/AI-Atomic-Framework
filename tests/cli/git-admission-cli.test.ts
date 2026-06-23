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

  console.log('[git-admission-cli] ok');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
