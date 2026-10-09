import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { forEachPathspecBatch, planPathspecBatches } from '../../packages/cli/src/commands/git-governance/implementation/pathspec-argv-batching.ts';

// Execute actual production reader bodies against real Git, without loading
// unrelated framework dependencies or creating a second implementation.
function body(file: string, name: string): string {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start);
  return stripTypeScriptTypes(source.slice(start, end).replace('export function', 'function'));
}
const transaction = '../../packages/cli/src/commands/git-governance/implementation/git-index-transaction.ts';
const diagnostics = '../../packages/cli/src/commands/hook/git-index-diagnostics.ts';
const input = '../../packages/cli/src/commands/hook/pre-commit/input-state.ts';
const command = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const normalize = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '');
const commitRead = new Function('runGitCommand', 'normalizeRelativePath',
  body(transaction, 'readStagedFiles') + ';return readStagedFiles;')(command, normalize);
const deletionRead = new Function('runGitCommand', 'normalizeRelativePath',
  body(transaction, 'readStagedDiffNames') + ';return readStagedDiffNames;')(command, normalize);
const recordRead = new Function('runGitCommand', 'CliError',
  body('../../packages/cli/src/commands/git-governance/implementation/record-commit-command.ts', 'assertExplicitRecordPathsAreDirty')
    + ';return assertExplicitRecordPathsAreDirty;')(command, Error);
const preservation = new Function('runGitCommand', 'forEachPathspecBatch', 'path', 'mkdirSync', 'writeFileSync', 'readFileSync', 'existsSync', 'rmSync',
  ['normalizeRelativePath', 'uniqueSorted'].map(name => body('../../packages/cli/src/commands/git-governance/commit-scope-policy.ts', name)).join('\n')
  + '\n' + ['readStagedDiffNames', 'deferStagedFilePaths', 'cleanupDeferredForeignStagedSnapshot'].map(name => body(transaction, name)).join('\n')
  + ';return { capture: deferStagedFilePaths, restore: cleanupDeferredForeignStagedSnapshot };'
)(command, forEachPathspecBatch, path, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync);
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-git-read-integrity-'));
const rawPaths = [' leading.txt', 'trailing ', 'back\\slash.txt', 'line\nbreak.txt', './literal.txt'];
assert.deepEqual(planPathspecBatches({ paths: rawPaths, fixedArgs: [] }).batches.flat(), [...rawPaths].sort(), 'batching must not rewrite path bytes');
try {
  command(repo, ['init', '-q']);
  const names = [' leading.txt', "中文 引號'.txt", '-dash.txt'];
  for (const name of names) writeFileSync(path.join(repo, name), `unique fixture content: ${name}\n`);
  assert.doesNotThrow(() => recordRead(repo, names), 'untracked record paths must retain exact Git names');
  command(repo, ['add', '--', ...names]);
  assert.deepEqual(commitRead(repo), [...names].sort((a, b) => a.localeCompare(b)));
  assert.throws(() => commitRead(path.join(repo, 'missing')), /Git|ENOENT|no such/i);
  const helper = new Function('spawnSync',
    ['createSanitizedGitEnv', 'runGit', 'runGitPathList'].map(name => body(diagnostics, name)).join('\n')
    + ';return runGitPathList;')(spawnSync);
  const hookRead = new Function('runGitPathList', 'uniqueSorted',
    body(input, 'readStagedFiles') + ';return readStagedFiles;')(helper,
    (values: string[]) => [...new Set(values)].sort());
  assert.deepEqual(hookRead(repo), [...names].sort());
  assert.throws(() => helper(repo, ['--invalid-read-option']), /Git read failed/);
  assert.throws(() => hookRead(path.join(repo, 'missing')), /Git read failed/);
  command(repo, ['-c', 'user.name=ATM Test', '-c', 'user.email=atm@example.invalid', 'commit', '-qm', 'fixture']);
  assert.deepEqual(commitRead(repo), [], 'successful empty reads remain empty');
  assert.deepEqual(hookRead(repo), []);
  assert.throws(() => recordRead(repo, names), /ATM_GIT_RECORD_COMMIT_PATH_NOT_DIRTY/);
  writeFileSync(path.join(repo, names[1]), 'changed unicode record');
  assert.doesNotThrow(() => recordRead(repo, [names[1]]), 'tracked dirty record paths must retain exact Git names');
  assert.throws(() => recordRead(path.join(repo, 'missing'), names), /Git|ENOENT|no such/i);
  command(repo, ['add', '--', names[1]]);
  writeFileSync(path.join(repo, names[1]), 'unstaged work must survive\n');
  const stagedPatch = command(repo, ['diff', '--cached', '--binary']);
  const parked = preservation.capture(repo, 'FIXTURE-ONLY', [names[1]]);
  assert.equal(command(repo, ['diff', '--cached', '--binary']), '');
  writeFileSync(path.join(repo, 'independent.txt'), 'other agent delivery\n');
  command(repo, ['add', '--', 'independent.txt']);
  command(repo, ['-c', 'user.name=ATM Test', '-c', 'user.email=atm@example.invalid', 'commit', '-qm', 'independent delivery']);
  assert.deepEqual(preservation.restore(repo, parked), [names[1]]);
  assert.equal(command(repo, ['diff', '--cached', '--binary']), stagedPatch, 'restore partial staged Unicode content after another commit');
  assert.equal(readFileSync(path.join(repo, names[1]), 'utf8'), 'unstaged work must survive\n');
  assert.equal(existsSync(path.join(repo, parked)), false);
  const beforeMissing = command(repo, ['ls-files', '--stage', '-z']);
  assert.throws(() => preservation.capture(repo, 'FIXTURE-ONLY', ['not-staged.txt']));
  assert.equal(command(repo, ['ls-files', '--stage', '-z']), beforeMissing, 'capture failures must not change the index');
  const stagedBlob = command(repo, ['rev-parse', `:${names[1]}`]).trim();
  execFileSync('git', ['update-index', '--index-info'], { cwd: repo, input: `0 ${'0'.repeat(40)}\t${names[1]}\n100644 ${stagedBlob} 1\t${names[1]}\n` });
  const unresolvedIndex = command(repo, ['ls-files', '--stage', '-z']);
  assert.throws(() => preservation.capture(repo, 'FIXTURE-ONLY', [names[1]]), /unresolved index entry/);
  assert.equal(command(repo, ['ls-files', '--stage', '-z']), unresolvedIndex, 'unmerged capture must fail before any index mutation');
  command(repo, ['update-index', '--add', '--cacheinfo', `100644,${stagedBlob},${names[1]}`]);
  command(repo, ['restore', '--staged', '--', names[1]]);
  writeFileSync(path.join(repo, names[1]), `unique fixture content: ${names[1]}\n`);
  command(repo, ['mv', '--', '-dash.txt', ' renamed.txt']);
  rmSync(path.join(repo, names[0]));
  command(repo, ['add', '-u']);
  assert.deepEqual(commitRead(repo), [' leading.txt', ' renamed.txt']);
  assert.deepEqual(hookRead(repo), [' leading.txt', ' renamed.txt']);
  unlinkSync(path.join(repo, names[1]));
  command(repo, ['add', '-u']);
  assert.deepEqual(deletionRead(repo, 'D').sort(), [names[0], names[1]].sort(),
    'deletion scope reader must preserve the same path bytes as staged reader');
  assert.throws(() => deletionRead(path.join(repo, 'missing'), 'D'), /Git|ENOENT|no such/i);
  const deletionPatch = command(repo, ['diff', '--cached', '--binary']);
  const deferredPaths = commitRead(repo);
  const deletedSnapshot = preservation.capture(repo, 'FIXTURE-ONLY', deferredPaths);
  assert.equal(command(repo, ['diff', '--cached', '--binary']), '');
  writeFileSync(path.join(repo, names[1]), 'recreated but unstaged\n');
  assert.deepEqual(preservation.restore(repo, deletedSnapshot), [...deferredPaths, '-dash.txt'].sort());
  assert.equal(command(repo, ['diff', '--cached', '--binary']), deletionPatch, 'restore deletion and rename index state exactly');
  assert.equal(readFileSync(path.join(repo, names[1]), 'utf8'), 'recreated but unstaged\n', 'restoring a staged deletion must not delete worktree bytes');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
console.log('[git-change-read-integrity] ok');
