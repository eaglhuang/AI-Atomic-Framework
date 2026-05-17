import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = createTempWorkspace('atm-claude-code-pack-');

const EXPECTED_FILES = [
  '.claude/commands/atm-bootstrap.md',
  '.claude/commands/atm-lock.md',
  '.claude/commands/atm-next.md',
  '.claude/commands/atm-evidence.md',
  '.claude/commands/atm-handoff.md',
  '.claude/commands/atm-verify.md',
];

try {
  // ── [1] install exits 0 ───────────────────────────────────────────────────
  const install = runAtm(['agent-pack', 'install', '--pack', 'claude-code', '--cwd', tempRoot]);
  assert.equal(install.exitCode, 0, 'install should exit 0');
  assert.equal(install.parsed.ok, true, 'install result.ok should be true');

  // ── [2] 6 .md files exist on disk ─────────────────────────────────────────
  for (const rel of EXPECTED_FILES) {
    assert.ok(existsSync(path.join(tempRoot, rel)), `install should create ${rel}`);
  }

  // ── [3] manifest exists ────────────────────────────────────────────────────
  const manifestPath = path.join(tempRoot, '.atm', 'agent-pack', 'claude-code.manifest.json');
  assert.ok(existsSync(manifestPath), 'install should write manifest');

  // ── [4] manifest has correct packId and 6 renderedFiles ───────────────────
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.packId, 'claude-code', 'manifest.packId should be claude-code');
  assert.equal(manifest.renderedManifest.renderedFiles.length, 6, 'manifest should record 6 rendered files');

  // ── [5] diff before modification shows 0 changed files ────────────────────
  const diffClean = runAtm(['agent-pack', 'diff', '--pack', 'claude-code', '--cwd', tempRoot]);
  assert.equal(diffClean.exitCode, 0, 'diff should exit 0');
  assert.equal(diffClean.parsed.evidence.changedFiles.length, 0, 'diff on unmodified install should show 0 changed files');

  // ── [6] modify one file (user edit) ───────────────────────────────────────
  const modifiedFile = path.join(tempRoot, '.claude', 'commands', 'atm-bootstrap.md');
  writeFileSync(modifiedFile, readFileSync(modifiedFile, 'utf8') + '\n# user-added line\n', 'utf8');

  // ── [7] diff after modification shows 1 changed file ─────────────────────
  const diffModified = runAtm(['agent-pack', 'diff', '--pack', 'claude-code', '--cwd', tempRoot]);
  assert.equal(diffModified.exitCode, 0, 'diff after user edit should exit 0');
  assert.equal(diffModified.parsed.evidence.changedFiles.length, 1, 'diff should show 1 changed file after user edit');
  assert.equal(diffModified.parsed.evidence.changedFiles[0].status, 'modified');

  // ── [8] uninstall exits 0 ─────────────────────────────────────────────────
  const uninstall = runAtm(['agent-pack', 'uninstall', '--pack', 'claude-code', '--cwd', tempRoot]);
  assert.equal(uninstall.exitCode, 0, 'uninstall should exit 0');
  assert.equal(uninstall.parsed.ok, true);

  // ── [9] unmodified files are gone ─────────────────────────────────────────
  const unmodifiedFile = path.join(tempRoot, '.claude', 'commands', 'atm-lock.md');
  assert.ok(!existsSync(unmodifiedFile), 'unmodified target file should be deleted on uninstall');

  // ── [10] user-modified file is backed up (.bak), not deleted ──────────────
  assert.ok(!existsSync(modifiedFile), 'user-modified file should not exist at original path after uninstall');
  assert.ok(existsSync(`${modifiedFile}.bak`), 'user-modified file should be preserved as .bak');

  // ── [11] manifest is removed ──────────────────────────────────────────────
  assert.ok(!existsSync(manifestPath), 'manifest should be removed on uninstall');

} finally {
  import('node:fs').then(({ rmSync }) => rmSync(tempRoot, { recursive: true, force: true }));
}

console.log('[agent-pack:claude-code] ok (11 acceptance checks)');

function runAtm(args: string[]) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    parsed: JSON.parse(
      payload || JSON.stringify({ ok: false, stdout: result.stdout, stderr: result.stderr })
    ),
  };
}
