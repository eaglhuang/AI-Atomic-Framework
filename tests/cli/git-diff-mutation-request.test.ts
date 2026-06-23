import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGitDiffMutationRequests } from '../../packages/cli/src/commands/git.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = path.resolve(root, '.atm-temp-test-git-diff-mutation-request');

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function writeText(filePath: string, contents: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf8');
}

function bootstrapScenario(name: string) {
  const scenarioRoot = path.join(tempRoot, name);
  const origin = path.join(scenarioRoot, 'origin.git');
  const local = path.join(scenarioRoot, 'local');
  const peer = path.join(scenarioRoot, 'peer');
  rmSync(scenarioRoot, { recursive: true, force: true });
  mkdirSync(scenarioRoot, { recursive: true });
  runGit(scenarioRoot, ['init', '--bare', origin]);
  runGit(scenarioRoot, ['clone', origin, local]);
  runGit(scenarioRoot, ['clone', origin, peer]);

  runGit(local, ['config', 'user.name', 'fixture-agent']);
  runGit(local, ['config', 'user.email', 'fixture-agent@example.com']);
  writeText(path.join(local, 'README.md'), '# fixture\n');
  runGit(local, ['add', 'README.md']);
  runGit(local, ['commit', '-m', 'chore: bootstrap']);
  runGit(local, ['branch', '-M', 'main']);
  runGit(local, ['push', '-u', 'origin', 'main']);

  runGit(peer, ['config', 'user.name', 'peer-agent']);
  runGit(peer, ['config', 'user.email', 'peer-agent@example.com']);
  runGit(peer, ['fetch', 'origin', 'main']);
  runGit(peer, ['checkout', '-B', 'main', 'origin/main']);

  return { scenarioRoot, origin, local, peer };
}

function runDiffMutationRequest(local: string) {
  return resolveGitDiffMutationRequests({
    cwd: local,
    actorId: 'fixture-agent',
    taskId: 'TASK-GIT-0002'
  });
}

try {
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });

  {
    const { local } = bootstrapScenario('no-remote-change');
    const evidence = runDiffMutationRequest(local);
    assert.equal(evidence.topology.branch, 'main');
    assert.equal(evidence.topology.remoteRef, 'origin/main');
    assert.equal(evidence.topology.fetched, true);
    assert.equal(evidence.localRequests.length, 0);
    assert.equal(evidence.remoteRequests.length, 0);
    assert.equal(evidence.localDiff.length, 0);
    assert.equal(evidence.remoteDiff.length, 0);
  }

  {
    const { local } = bootstrapScenario('local-only');
    writeText(path.join(local, 'src', 'local-only.ts'), 'export const localOnly = true;\n');
    runGit(local, ['add', 'src/local-only.ts']);
    runGit(local, ['commit', '-m', 'feat: local only']);
    const evidence = runDiffMutationRequest(local);
    assert.equal(evidence.localRequests.length, 1);
    assert.equal(evidence.remoteRequests.length, 0);
    assert.equal(evidence.localRequests[0].actorId, 'fixture-agent');
    assert.equal(evidence.localRequests[0].filePath, 'src/local-only.ts');
    assert.equal(evidence.localRequests[0].op, 'added');
    assert.equal((evidence.localRequests[0].value as { side?: string }).side, 'local');
    assert.equal((evidence.localRequests[0].value as { rawStatus?: string }).rawStatus, 'A');
  }

  {
    const { local, peer } = bootstrapScenario('remote-only');
    writeText(path.join(peer, 'src', 'remote-only.ts'), 'export const remoteOnly = true;\n');
    runGit(peer, ['add', 'src/remote-only.ts']);
    runGit(peer, ['commit', '-m', 'feat: remote only']);
    runGit(peer, ['push', 'origin', 'main']);
    const remoteSha = runGit(peer, ['rev-parse', 'HEAD']);
    const evidence = runDiffMutationRequest(local);
    assert.equal(evidence.localRequests.length, 0);
    assert.equal(evidence.remoteRequests.length, 1);
    assert.equal(evidence.remoteRequests[0].actorId, `virtual:git-remote@${remoteSha}`);
    assert.equal(evidence.remoteRequests[0].filePath, 'src/remote-only.ts');
    assert.equal(evidence.remoteRequests[0].op, 'added');
    assert.equal((evidence.remoteRequests[0].value as { side?: string }).side, 'remote');
    assert.equal((evidence.remoteRequests[0].value as { rawStatus?: string }).rawStatus, 'A');
  }

  {
    const { local, peer } = bootstrapScenario('divergent');
    writeText(path.join(local, 'src', 'local-divergent.ts'), 'export const localDivergent = true;\n');
    runGit(local, ['add', 'src/local-divergent.ts']);
    runGit(local, ['commit', '-m', 'feat: local divergent']);

    writeText(path.join(peer, 'src', 'remote-divergent.ts'), 'export const remoteDivergent = true;\n');
    runGit(peer, ['add', 'src/remote-divergent.ts']);
    runGit(peer, ['commit', '-m', 'feat: remote divergent']);
    runGit(peer, ['push', 'origin', 'main']);

    const remoteSha = runGit(peer, ['rev-parse', 'HEAD']);
    const bootstrapSha = runGit(local, ['rev-parse', 'origin/main']);
    const evidence = runDiffMutationRequest(local);
    assert.equal(evidence.localRequests.length, 1);
    assert.equal(evidence.remoteRequests.length, 1);
    assert.equal(evidence.topology.mergeBaseSha, bootstrapSha);
    assert.equal(evidence.topology.remoteSha, remoteSha);
    assert.equal(evidence.localRequests[0].filePath, 'src/local-divergent.ts');
    assert.equal(evidence.remoteRequests[0].filePath, 'src/remote-divergent.ts');
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
