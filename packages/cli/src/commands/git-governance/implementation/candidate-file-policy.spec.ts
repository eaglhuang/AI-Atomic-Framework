import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertFinalCandidateIndex, candidateGit, nulPaths, resolveCandidateFiles, stageExactCandidateFiles } from './candidate-file-policy.ts';
import { assembleSealedCommitIndex, readCandidateTreeEntries, sealCommitBundleFromCandidateIndex, withWorktreeCandidateIndex } from './sealed-commit-candidate-index.ts';
import { sealCommitBundle } from '../../../../../core/src/commit-attribution/sealed-commit-bundle.ts';

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
