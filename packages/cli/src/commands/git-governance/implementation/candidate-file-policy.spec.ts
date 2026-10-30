import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertFinalCandidateIndex, candidateGit, nulPaths, resolveCandidateFiles, stageExactCandidateFiles } from './candidate-file-policy.ts';
import { assembleSealedCommitIndex, readCandidateTreeEntries, sealCommitBundleFromCandidateIndex, withWorktreeCandidateIndex } from './sealed-commit-candidate-index.ts';
import { sealCommitBundle } from '../../../../../core/src/commit-attribution/sealed-commit-bundle.ts';
import { buildRunnerBuildOutputInventory } from '../../../../../core/src/broker/runner-build-output-inventory.ts';
import { resolveRunnerPublicationCloseHandoff } from '../../framework-development/runner-publication-close-handoff.ts';

test('candidate discovery supports an unborn repository without changing its staged index', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-unborn-candidates-'));
  try {
    candidateGit(cwd, ['init']);
    mkdirSync(path.join(cwd, 'src/nested'), { recursive: true });
    writeFileSync(path.join(cwd, 'src/direct.ts'), 'direct');
    writeFileSync(path.join(cwd, 'src/nested/child.ts'), 'nested');
    writeFileSync(path.join(cwd, 'staged.txt'), 'staged bytes');
    candidateGit(cwd, ['add', '--', 'staged.txt']);
    const before = candidateGit(cwd, ['ls-files', '-s', '-z']);
    assert.deepEqual(resolveCandidateFiles(cwd, ['src/**/*.ts'], { scopePaths: ['src/**/*.ts'] }), ['src/direct.ts', 'src/nested/child.ts']);
    assert.equal(candidateGit(cwd, ['ls-files', '-s', '-z']), before);
    assert.throws(() => candidateGit(cwd, ['rev-parse', '--verify', 'HEAD']), /HEAD/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-p2-candidates-'));
const outside = mkdtempSync(path.join(os.tmpdir(), 'atm-p2-external-'));
const git = (...args: string[]) => candidateGit(root, args);
function put(file: string, content = 'payload\n') {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}
try {
  git('init');
  git('config', 'user.email', 'p2@example.invalid');
  git('config', 'user.name', 'P2 regression');
  put('.gitignore', '*.pyc\nignored/\n');
  put('dir/deleted.pyc');
  put('other.txt', 'original\n');
  stageExactCandidateFiles(root, ['.gitignore', 'dir/deleted.pyc', 'other.txt']);
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture');
  const head = git('rev-parse', 'HEAD').trim();
  // A gitlink without a worktree .git marker must still be excluded.
  git('update-index', '--add', '--cacheinfo', `160000,${head},dir/gitlink`);
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'gitlink fixture');
  rmSync(path.join(root, 'dir/deleted.pyc'));
  stageExactCandidateFiles(root, ['dir/deleted.pyc']);
  put('other.txt', 'foreign staged\n');
  stageExactCandidateFiles(root, ['other.txt']);
  const realIndex = () => readFileSync(path.join(root, '.git/index'));
  const before = realIndex();
  put('dir/plain.txt');
  put('dir/cache.pyc');
  put('ignored/declared.pyc');
  put('ignored/undeclared.pyc');
  mkdirSync(path.join(root, 'dir/nested/.git'), { recursive: true });
  put('dir/nested/hidden.txt');
  put('dir/worktree/.git', 'gitdir: /unavailable\n');
  put('dir/worktree/hidden.txt');
  put('dir/gitlink/hidden.txt');
  writeFileSync(path.join(outside, 'secret.txt'), 'external contents');
  symlinkSync(outside, path.join(root, 'dir/external'));
  symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'dir/declared-link'));
  symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'dir/automatic-link'));
  const special = ['dir/space name', 'dir/new\nline', 'dir/-leading', '-root', 'dir/[x]*?.txt', 'dir/中文', 'dir/ trailing ', 'dir/line\n'];
  for (const file of special) put(file);
  const policy = { declaredPaths: ['dir', 'ignored/declared.pyc', 'dir/declared-link'], scopePaths: ['dir/**', 'ignored/**', '-root'] };
  const expected = ['dir/plain.txt', 'dir/deleted.pyc', 'ignored/declared.pyc', 'dir/declared-link', ...special].sort();
  assert.deepEqual(resolveCandidateFiles(root, ['dir/**', 'ignored', '-root'], policy), expected);
  let checks = 0;
  withWorktreeCandidateIndex({ cwd: root, paths: ['dir', 'ignored', '-root'], policy, run: (env, files) => {
    assert.deepEqual([...files].sort(), expected);
    assert.deepEqual(nulPaths(candidateGit(root, ['diff', '--cached', '--no-renames', '--name-only', '-z'], env)).sort(), expected);
    const bundle = sealCommitBundleFromCandidateIndex({ cwd: root, env, paths: files, policy });
    assert.equal(bundle.entries.find((entry) => entry.path === 'dir/deleted.pyc')?.disposition, 'deleted');
    assert.equal(bundle.entries.find((entry) => entry.path === 'dir/declared-link')?.mode, '120000');
    const indexDir = mkdtempSync(path.join(os.tmpdir(), 'atm-p2-sealed-'));
    try {
      const sealedEnv = { GIT_INDEX_FILE: path.join(indexDir, 'index') };
      assembleSealedCommitIndex({ cwd: root, bundle, env: sealedEnv });
      assert.deepEqual(readCandidateTreeEntries({ cwd: root, env: sealedEnv, sealedPaths: files }).map((entry) => entry.path).sort(), expected);
      assert.deepEqual(realIndex(), before, 'sealed assembly preserves real index');
      const ignoredBlob = candidateGit(root, ['hash-object', '-w', '--stdin'], undefined, 'ignored bytes').trim();
      const bad = sealCommitBundle({ entries: [{ path: 'ignored/undeclared.pyc', blobId: ignoredBlob, mode: '100644', provenance: 'task-scope' }] });
      assert.throws(() => assembleSealedCommitIndex({ cwd: root, bundle: bad, env: sealedEnv }), /undeclared ignored/i);
      assert.deepEqual(realIndex(), before, 'failed sealed assembly preserves real index');
      for (const file of ['dir/nested/hidden.txt', 'dir/worktree/hidden.txt', 'dir/gitlink/hidden.txt', 'dir/external/secret.txt']) {
        const unsafe = sealCommitBundle({ entries: [{ path: file, blobId: ignoredBlob, mode: '100644', provenance: 'task-scope', declared: true }] });
        assert.throws(() => assembleSealedCommitIndex({ cwd: root, bundle: unsafe, env: sealedEnv }), /unsafe/i);
      }
      checks++;
    } finally { rmSync(indexDir, { recursive: true, force: true }); }
  } });
  assert.equal(checks, 1);
  assert.deepEqual(realIndex(), before, 'successful worktree candidate preserves real index');
  assert.throws(() => withWorktreeCandidateIndex({ cwd: root, paths: ['dir'], policy, run: () => { throw new Error('callback failure'); } }), /callback failure/);
  assert.deepEqual(realIndex(), before, 'failed worktree candidate preserves real index');
  assert.throws(() => withWorktreeCandidateIndex({ cwd: root, paths: [], run: (env) => {
    stageExactCandidateFiles(root, ['ignored/undeclared.pyc'], env);
    assert.throws(() => assertFinalCandidateIndex(root, env), /undeclared ignored/i);
  } }), /undeclared ignored/i, 'final index must be checked after callback too');
  assert.deepEqual(realIndex(), before);
  assert.deepEqual(resolveCandidateFiles(root, ['ignored/declared.pyc'], { declaredPaths: ['ignored/declared.pyc'], scopePaths: ['dir/**'] }), []);
  assert.deepEqual(resolveCandidateFiles(root, ['ignored/declared.pyc'], { declaredPaths: ['ignored/declared.pyc'], scopePaths: ['ignored/**'], readOnlyPaths: ['ignored/**'] }), []);
  assert.deepEqual(resolveCandidateFiles(root, ['ignored/declared.pyc'], { declaredPaths: ['ignored/declared.pyc'], scopePaths: ['ignored/**'], readOnlyPaths: [path.join(root, 'ignored')] }), []);
  assert.throws(() => stageExactCandidateFiles(root, ['dir']), /exact file paths/);
  console.log('[candidate-file-policy] ok: both paths, deletions, ignored children, literal names, repository boundaries, symlinks, final index, index preservation');
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
}

function fixture(run: (cwd: string) => void) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-p2-regression-'));
  try {
    candidateGit(cwd, ['init']);
    candidateGit(cwd, ['config', 'user.email', 'p2@example.invalid']);
    candidateGit(cwd, ['config', 'user.name', 'P2 regression']);
    candidateGit(cwd, ['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'fixture']);
    run(cwd);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

test('literal wildcard filenames select only the requested tracked path, including deletions', () => fixture((cwd) => {
  const literals = ['star*.txt', 'question?.txt'];
  const peers = ['star-peer.txt', 'questionX.txt'];
  for (const file of [...literals, ...peers]) writeFileSync(path.join(cwd, file), 'base');
  stageExactCandidateFiles(cwd, [...literals, ...peers]);
  candidateGit(cwd, ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'tracked names']);
  for (const file of literals) {
    assert.deepEqual(resolveCandidateFiles(cwd, [file]), [file]);
    rmSync(path.join(cwd, file));
    assert.deepEqual(resolveCandidateFiles(cwd, [file]), [file]);
  }
  assert.deepEqual(resolveCandidateFiles(cwd, ['star*.txt'], { declaredPaths: ['star*.txt'] }), ['star*.txt']);
}));

test('final index rejects ordinary files outside scope or under read-only paths, including deletions', () => fixture((cwd) => {
  writeFileSync(path.join(cwd, 'ordinary.txt'), 'base');
  stageExactCandidateFiles(cwd, ['ordinary.txt']);
  candidateGit(cwd, ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'ordinary file']);
  for (const deleted of [false, true]) {
    if (deleted) rmSync(path.join(cwd, 'ordinary.txt'));
    else writeFileSync(path.join(cwd, 'ordinary.txt'), 'changed');
    for (const policy of [
      { scopePaths: ['allowed/**'] },
      { scopePaths: ['ordinary.txt'], readOnlyPaths: ['ordinary.txt'] },
      { readOnlyPaths: [path.join(cwd, 'ordinary.txt')] }
    ]) {
      assert.throws(() => withWorktreeCandidateIndex({ cwd, paths: [], policy, run: (env) => {
        stageExactCandidateFiles(cwd, ['ordinary.txt'], env);
      } }), /scope|read.only/i);
    }
  }
}));

test('sealed index applies tombstones before directory-to-file and file-to-directory replacements', () => fixture((cwd) => {
  mkdirSync(path.join(cwd, 'directory'));
  writeFileSync(path.join(cwd, 'directory/child.txt'), 'child');
  writeFileSync(path.join(cwd, 'file'), 'file');
  stageExactCandidateFiles(cwd, ['directory/child.txt', 'file']);
  candidateGit(cwd, ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'replacement base']);
  const blobId = candidateGit(cwd, ['hash-object', '-w', '--stdin'], undefined, 'replacement').trim();
  const bundle = sealCommitBundle({ entries: [
    { path: 'directory', mode: '100644', blobId, provenance: 'task-scope' },
    { path: 'directory/child.txt', mode: '100644', blobId: '', disposition: 'deleted', provenance: 'task-scope' },
    { path: 'file', mode: '100644', blobId: '', disposition: 'deleted', provenance: 'task-scope' },
    { path: 'file/child.txt', mode: '100644', blobId, provenance: 'task-scope' }
  ] });
  const indexDir = mkdtempSync(path.join(os.tmpdir(), 'atm-p2-replacement-index-'));
  try {
    const env = { GIT_INDEX_FILE: path.join(indexDir, 'index') };
    assembleSealedCommitIndex({ cwd, bundle, env });
    assert.deepEqual(nulPaths(candidateGit(cwd, ['ls-files', '-z'], env)), ['directory', 'file/child.txt']);
    candidateGit(cwd, ['write-tree'], env);
  } finally { rmSync(indexDir, { recursive: true, force: true }); }
}));

test('tracked outputs under an ignored directory stay candidates; new ignored outputs need an exact declaration', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-tracked-ignored-'));
  const indexDir = mkdtempSync(path.join(os.tmpdir(), 'atm-tracked-ignored-index-'));
  try {
    const run = (...args: string[]) => candidateGit(cwd, args);
    run('init'); run('config', 'user.email', 'p2@example.invalid'); run('config', 'user.name', 'P2 regression');
    mkdirSync(path.join(cwd, 'dist'), { recursive: true });
    writeFileSync(path.join(cwd, '.gitignore'), 'dist/\n');
    writeFileSync(path.join(cwd, 'dist/tracked.js'), 'old\n');
    stageExactCandidateFiles(cwd, ['.gitignore', 'dist/tracked.js']);
    run('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture');
    writeFileSync(path.join(cwd, 'dist/tracked.js'), 'rebuilt\n');
    writeFileSync(path.join(cwd, 'dist/new-module.js'), 'new\n');
    const taskId = 'TASK-P2-0002';
    const outputs = ['dist/tracked.js', 'dist/new-module.js'];
    const outputInventory = buildRunnerBuildOutputInventory({ cwd, sealedSourceSha: 'source', outputPaths: outputs, currentTaskId: taskId, ownership: outputs.map((file) => ({ path: file, ownerTaskId: taskId })) });
    const receipt = { schemaId: 'atm.runnerSyncReceipt.v1', taskId, outputInventory, memberTaskIds: [taskId], groupManifest: { memberTaskIds: [taskId] }, childAttribution: { complete: true, members: [{ taskId }] } };
    assert.deepEqual(resolveRunnerPublicationCloseHandoff({ taskId, receipt, cwd }).stageFiles, ['dist/tracked.js'], 'tracked receipt-owned output is delivered; untracked ignored output is not');
    const scope = { scopePaths: ['dist/**'] };
    assert.deepEqual(resolveCandidateFiles(cwd, ['dist/**'], scope), ['dist/tracked.js']);
    const declared = { ...scope, declaredPaths: ['dist/new-module.js'] };
    assert.deepEqual(resolveCandidateFiles(cwd, ['dist/**'], declared), ['dist/new-module.js', 'dist/tracked.js']);
    const env = { GIT_INDEX_FILE: path.join(indexDir, 'index') };
    candidateGit(cwd, ['read-tree', 'HEAD'], env);
    stageExactCandidateFiles(cwd, ['dist/tracked.js'], env);
    assertFinalCandidateIndex(cwd, env, scope);
    stageExactCandidateFiles(cwd, ['dist/new-module.js'], env);
    assert.throws(() => assertFinalCandidateIndex(cwd, env, scope), /undeclared ignored/i);
    assertFinalCandidateIndex(cwd, env, declared);
  } finally { rmSync(cwd, { recursive: true, force: true }); rmSync(indexDir, { recursive: true, force: true }); }
});
