import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGitNameStatusZ } from '../../packages/core/src/git/diff-mutation-request.ts';
import { bridgeGitDiffEntriesToAdapterConflictKeys } from '../../packages/core/src/git/format-adapter-bridge.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = path.resolve(root, '.atm-temp-test-git-format-adapter-bridge');

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

function setupRepo(name: string) {
  const repo = path.join(tempRoot, name);
  rmSync(repo, { recursive: true, force: true });
  mkdirSync(repo, { recursive: true });
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.name', 'fixture-agent']);
  runGit(repo, ['config', 'user.email', 'fixture-agent@example.com']);
  writeText(path.join(repo, 'README.md'), '# fixture\n');
  runGit(repo, ['add', 'README.md']);
  runGit(repo, ['commit', '-m', 'chore: bootstrap']);
  const baseRef = runGit(repo, ['rev-parse', 'HEAD']);
  return { repo, baseRef };
}

function bridgeRange(repo: string, baseRef: string, targetRef: string, filePath: string) {
  const diff = execFileSync('git', ['diff', '--name-status', '-z', baseRef, targetRef, '--', filePath], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const entries = parseGitNameStatusZ(diff);
  return bridgeGitDiffEntriesToAdapterConflictKeys({
    cwd: repo,
    baseRef,
    targetRef,
    entries,
    actorId: 'fixture-agent',
    taskId: 'TASK-GIT-0003'
  });
}

try {
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });

  {
    const { repo, baseRef } = setupRepo('json-record');
    writeText(path.join(repo, 'data.json'), `${JSON.stringify({ alpha: 1, nested: { beta: 2 }, list: ['a', 'b'] }, null, 2)}\n`);
    runGit(repo, ['add', 'data.json']);
    runGit(repo, ['commit', '-m', 'feat: add data']);
    const jsonBase = runGit(repo, ['rev-parse', 'HEAD']);
    writeText(path.join(repo, 'data.json'), `${JSON.stringify({ alpha: 1, nested: { beta: 3 }, list: ['a', 'c'] }, null, 2)}\n`);
    runGit(repo, ['add', 'data.json']);
    runGit(repo, ['commit', '-m', 'feat: change data']);
    const headRef = runGit(repo, ['rev-parse', 'HEAD']);
    const bridged = bridgeRange(repo, jsonBase, headRef, 'data.json');
    assert.equal(bridged.entries.length, 1);
    assert.equal(bridged.entries[0].adapterId, 'json-record');
    assert.deepEqual(
      bridged.entries[0].conflictKeys.map((key) => key.key).sort(),
      ['record:data.json::/list/1', 'record:data.json::/nested/beta']
    );
    assert.equal(bridged.entries[0].failClosed, false);
    assert.equal(baseRef.length > 0, true);
  }

  {
    const { repo } = setupRepo('atom-map');
    const shardPath = 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-core.json';
    writeText(path.join(repo, shardPath), `${JSON.stringify({
      schemaId: 'atm.pathToAtomMapOwnerShard.v1',
      owner: 'core',
      version: '1.0',
      mappings: [
        { path_pattern: 'packages/core/src/a.ts', atom_id: 'ATOM-A', capability: 'cap-a', coverage_status: 'covered' }
      ]
    }, null, 2)}\n`);
    runGit(repo, ['add', shardPath]);
    runGit(repo, ['commit', '-m', 'feat: add shard']);
    const shardBase = runGit(repo, ['rev-parse', 'HEAD']);
    writeText(path.join(repo, shardPath), `${JSON.stringify({
      schemaId: 'atm.pathToAtomMapOwnerShard.v1',
      owner: 'core',
      version: '2.0',
      mappings: [
        { path_pattern: 'packages/core/src/a.ts', atom_id: 'ATOM-A', capability: 'cap-a2', coverage_status: 'covered' }
      ]
    }, null, 2)}\n`);
    runGit(repo, ['add', shardPath]);
    runGit(repo, ['commit', '-m', 'feat: update shard']);
    const headRef = runGit(repo, ['rev-parse', 'HEAD']);
    const bridged = bridgeRange(repo, shardBase, headRef, shardPath);
    assert.equal(bridged.entries[0].adapterId, 'path-to-atom-map');
    assert.deepEqual(
      bridged.entries[0].conflictKeys.map((key) => key.key).sort(),
      ['atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-core.json', 'record:packages/core/src/a.ts::ATOM-A']
    );
  }

  {
    const { repo } = setupRepo('text-fallback');
    writeText(path.join(repo, 'src', 'sample.ts'), 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
    runGit(repo, ['add', 'src/sample.ts']);
    runGit(repo, ['commit', '-m', 'feat: add sample']);
    const tsBase = runGit(repo, ['rev-parse', 'HEAD']);
    writeText(path.join(repo, 'src', 'sample.ts'), 'export const a = 1;\nexport const b = 20;\nexport const c = 3;\n');
    runGit(repo, ['add', 'src/sample.ts']);
    runGit(repo, ['commit', '-m', 'feat: update sample']);
    const headRef = runGit(repo, ['rev-parse', 'HEAD']);
    const bridged = bridgeRange(repo, tsBase, headRef, 'src/sample.ts');
    assert.equal(bridged.entries[0].adapterId, 'text-range');
    assert.deepEqual(bridged.entries[0].conflictKeys.map((key) => key.key), ['range:src/sample.ts::2-2']);
    assert.equal(bridged.entries[0].failClosed, false);
  }

  {
    const { repo } = setupRepo('invalid-json');
    writeText(path.join(repo, 'broken.json'), '{"good": true}\n');
    runGit(repo, ['add', 'broken.json']);
    runGit(repo, ['commit', '-m', 'feat: add good json']);
    const jsonBase = runGit(repo, ['rev-parse', 'HEAD']);
    writeText(path.join(repo, 'broken.json'), '{"good": \n');
    runGit(repo, ['add', 'broken.json']);
    runGit(repo, ['commit', '-m', 'feat: break json']);
    const headRef = runGit(repo, ['rev-parse', 'HEAD']);
    const bridged = bridgeRange(repo, jsonBase, headRef, 'broken.json');
    assert.equal(bridged.entries[0].adapterId, 'fallback-file-lock');
    assert.equal(bridged.entries[0].failClosed, true);
    assert.equal(bridged.entries[0].diagnostics[0]?.code, 'ATM_GIT_ADAPTER_JSON_PARSE_FAILED');
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
