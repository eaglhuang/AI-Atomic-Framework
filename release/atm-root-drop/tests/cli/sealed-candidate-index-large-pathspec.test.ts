import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { sealCommitBundleFromLiveIndex } from '../../packages/cli/src/commands/git-governance/implementation/sealed-commit-candidate-index.ts';

function git(root: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('sealing a bundle whose paths exceed one command line still reads every entry', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-sealed-large-pathspec-'));
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.name', 'Fixture');
    git(root, 'config', 'user.email', 'fixture@example.invalid');
    writeFileSync(path.join(root, 'README.md'), 'fixture');
    git(root, 'add', '--', 'README.md');
    git(root, 'commit', '-qm', 'baseline');
    const dir = 'release/' + 'nested-directory-name/'.repeat(4);
    mkdirSync(path.join(root, dir), { recursive: true });
    const files: string[] = [];
    for (let i = 0; i < 1500; i += 1) {
      const file = `${dir}generated-output-file-${String(i).padStart(5, '0')}.js`;
      writeFileSync(path.join(root, file), `export const n = ${i};\n`);
      files.push(file);
    }
    assert.ok(files.join(' ').length > 100_000, 'fixture must exceed any single command-line limit');
    git(root, 'add', '--', '.');
    const bundle = sealCommitBundleFromLiveIndex({ cwd: root, paths: files, provenance: 'task-scope' });
    assert.equal(bundle.entries.length, files.length);
    assert.deepEqual(bundle.entries.map(entry => entry.path).sort(), [...files].sort());
  } finally { rmSync(root, { recursive: true, force: true }); }
});
