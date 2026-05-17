import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from '../../scripts/temp-root.ts';
import { renderManifest, hashFiles } from '../../packages/agent-pack-sdk/src/index.ts';
import type { AgentPack } from '../../packages/agent-pack-sdk/src/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = createTempWorkspace('atm-agent-pack-');

try {
  // ── SDK unit: renderManifest positive ────────────────────────────────────
  const pack: AgentPack = {
    packId: 'test-pack',
    name: 'Test Pack',
    version: '0.1.0',
    agentTarget: 'test-agent',
    targetFiles: [
      { path: 'AGENTS.md', template: '# ATM Agent Pack\n\nRun `node atm.mjs next --json`.\n', protected: false }
    ]
  };
  const manifest = renderManifest(pack, { cwd: tempRoot });
  assert.equal(manifest.packId, 'test-pack');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.renderedFiles.length, 1);
  assert.equal(manifest.renderedFiles[0].path, 'AGENTS.md');
  assert.ok(manifest.renderedFiles[0].contentHash.length === 64, 'contentHash should be a 64-char hex SHA-256');
  assert.ok(typeof manifest.installedAt === 'string', 'installedAt should be set');
  assert.ok(typeof manifest.sourceHash === 'string', 'sourceHash should be set');

  // ── SDK unit: hashFiles aggregate ────────────────────────────────────────
  const hash1 = hashFiles(['hello', 'world']);
  const hash2 = hashFiles(['hello', 'world']);
  const hash3 = hashFiles(['world', 'hello']);
  assert.equal(hash1, hash2, 'hashFiles should be deterministic');
  assert.notEqual(hash1, hash3, 'hashFiles order matters');

  // ── SDK unit: renderManifest with vars substitution ──────────────────────
  const packWithVars: AgentPack = {
    packId: 'vars-pack',
    name: 'Vars Pack',
    version: '1.0.0',
    agentTarget: 'generic',
    targetFiles: [
      { path: 'AGENTS.md', template: 'Project: {{projectName}}\n', protected: false }
    ]
  };
  const manifestWithVars = renderManifest(packWithVars, { cwd: tempRoot, vars: { projectName: 'MyRepo' } });
  assert.equal(manifestWithVars.renderedFiles.length, 1);
  // hash of 'Project: MyRepo\n' should differ from unsubstituted
  const manifestNoVars = renderManifest(packWithVars, { cwd: tempRoot });
  assert.notEqual(
    manifestWithVars.renderedFiles[0].contentHash,
    manifestNoVars.renderedFiles[0].contentHash,
    'var substitution should change content hash'
  );

  // ── CLI: agent-pack list ──────────────────────────────────────────────────
  const list = runAtm(['agent-pack', 'list', '--cwd', tempRoot]);
  assert.equal(list.exitCode, 0, 'agent-pack list should exit 0');
  assert.equal(list.parsed.ok, true);
  assert.equal(list.parsed.evidence.action, 'list');
  assert.ok(Array.isArray(list.parsed.evidence.installedPacks));

  // ── CLI: agent-pack install (dry-run) ─────────────────────────────────────
  const installDry = runAtm(['agent-pack', 'install', '--pack', 'claude-code', '--dry-run', '--cwd', tempRoot]);
  assert.equal(installDry.exitCode, 0, 'agent-pack install --dry-run should exit 0');
  assert.equal(installDry.parsed.ok, true);
  assert.equal(installDry.parsed.evidence.action, 'install');
  assert.equal(installDry.parsed.evidence.dryRun, true);

  // ── CLI: agent-pack install (real) ────────────────────────────────────────
  const install = runAtm(['agent-pack', 'install', '--pack', 'claude-code', '--cwd', tempRoot]);
  assert.equal(install.exitCode, 0, 'agent-pack install should exit 0');
  assert.equal(install.parsed.ok, true);
  assert.equal(install.parsed.evidence.manifest.packId, 'claude-code');

  // ── CLI: agent-pack diff ──────────────────────────────────────────────────
  const diff = runAtm(['agent-pack', 'diff', '--pack', 'claude-code', '--cwd', tempRoot]);
  assert.equal(diff.exitCode, 0, 'agent-pack diff should exit 0');
  assert.equal(diff.parsed.ok, true);
  assert.equal(diff.parsed.evidence.action, 'diff');
  assert.ok(Array.isArray(diff.parsed.evidence.changedFiles));

  // ── CLI: agent-pack uninstall ─────────────────────────────────────────────
  const uninstall = runAtm(['agent-pack', 'uninstall', '--pack', 'claude-code', '--cwd', tempRoot]);
  assert.equal(uninstall.exitCode, 0, 'agent-pack uninstall should exit 0');
  assert.equal(uninstall.parsed.ok, true);
  assert.equal(uninstall.parsed.evidence.action, 'uninstall');

  // ── CLI: agent-pack install missing --pack ────────────────────────────────
  const missingPack = runAtm(['agent-pack', 'install', '--cwd', tempRoot]);
  assert.equal(missingPack.exitCode, 2, 'agent-pack install without --pack should fail with exit 2');
  assert.equal(missingPack.parsed.ok, false);

} finally {
  import('node:fs').then(({ rmSync }) => rmSync(tempRoot, { recursive: true, force: true }));
}

console.log('[agent-pack:test] ok (8 acceptance checks)');

function runAtm(args: string[]) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    parsed: JSON.parse(
      payload || JSON.stringify({ ok: false, stdout: result.stdout, stderr: result.stderr })
    )
  };
}
