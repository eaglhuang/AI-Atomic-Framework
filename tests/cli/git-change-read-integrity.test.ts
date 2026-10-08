import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

// Execute actual production reader bodies against real Git, without loading
// unrelated framework dependencies or creating a second implementation.
function body(file: string, name: string): string {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const start = source.indexOf(`export function ${name}(`);
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
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-git-read-integrity-'));
try {
  command(repo, ['init', '-q']);
  const names = [' leading.txt', "中文 引號'.txt", '-dash.txt'];
  for (const name of names) writeFileSync(path.join(repo, name), `unique fixture content: ${name}\n`);
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
  command(repo, ['mv', '--', '-dash.txt', ' renamed.txt']);
  rmSync(path.join(repo, names[0]));
  command(repo, ['add', '-u']);
  assert.deepEqual(commitRead(repo), [' leading.txt', ' renamed.txt']);
  assert.deepEqual(hookRead(repo), [' leading.txt', ' renamed.txt']);
} finally {
  rmSync(repo, { recursive: true, force: true });
}
console.log('[git-change-read-integrity] ok');
