import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listReleaseSourceFiles } from '../../scripts/build-root-drop-release.ts';

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim();
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-root-drop-source-list-'));

try {
  git(repo, ['init']);
  git(repo, ['config', 'user.name', 'ATM Test']);
  git(repo, ['config', 'user.email', 'atm-test@example.invalid']);

  const existing = path.join(repo, 'packages', 'cli', 'dist', 'atm.js');
  const stale = path.join(repo, 'packages', 'cli', 'dist', 'commands', '__tests__', 'stale.spec.d.ts');
  mkdirSync(path.dirname(existing), { recursive: true });
  mkdirSync(path.dirname(stale), { recursive: true });
  writeFileSync(existing, 'export const atm = true;\n', 'utf8');
  writeFileSync(stale, 'export {};\n', 'utf8');
  git(repo, ['add', 'packages/cli/dist/atm.js', 'packages/cli/dist/commands/__tests__/stale.spec.d.ts']);
  unlinkSync(stale);

  assert.equal(existsSync(stale), false, 'fixture stale declaration must be absent from worktree');
  const files = listReleaseSourceFiles(repo);

  assert.ok(files.includes('packages/cli/dist/atm.js'), 'existing tracked release source should remain included');
  assert.equal(
    files.includes('packages/cli/dist/commands/__tests__/stale.spec.d.ts'),
    false,
    'missing tracked generated output must not be copied into root-drop release'
  );

  console.log('ok: root-drop release source list excludes stale tracked generated outputs');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
