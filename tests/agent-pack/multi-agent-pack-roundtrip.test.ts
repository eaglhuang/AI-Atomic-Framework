import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const packCases = [
  {
    packId: 'cursor',
    expectedFiles: ['.cursor/rules/skills/atm-next/SKILL.md']
  },
  {
    packId: 'copilot',
    expectedFiles: ['.github/copilot-instructions.md', '.github/prompts/atm-next.prompt.md']
  },
  {
    packId: 'gemini',
    expectedFiles: ['.gemini/commands/atm-next.toml']
  },
  {
    packId: 'windsurf',
    expectedFiles: ['.windsurf/workflows/atm-next.md']
  }
] as const;

for (const packCase of packCases) {
  const tempRoot = createTempWorkspace(`atm-${packCase.packId}-pack-`);
  try {
    const bootstrap = runAtm(['bootstrap', '--cwd', tempRoot]);
    assert.equal(bootstrap.exitCode, 0, `${packCase.packId} bootstrap should exit 0`);

    const atmChartRender = runAtm(['atm-chart', 'render', '--cwd', tempRoot]);
    assert.equal(atmChartRender.exitCode, 0, `${packCase.packId} atm-chart render should exit 0`);

    const install = runAtm(['agent-pack', 'install', '--id', packCase.packId, '--cwd', tempRoot]);
    assert.equal(install.exitCode, 0, `${packCase.packId} install should exit 0`);
    assert.equal(install.parsed.ok, true, `${packCase.packId} install should report ok=true`);
    assert.equal(install.parsed.evidence.manifest.packId, packCase.packId, `${packCase.packId} manifest packId should match`);

    const manifestPath = path.join(tempRoot, '.atm', 'agent-pack', `${packCase.packId}.manifest.json`);
    assert.ok(existsSync(manifestPath), `${packCase.packId} install should write manifest`);
    for (const expectedFile of packCase.expectedFiles) {
      assert.ok(existsSync(path.join(tempRoot, expectedFile)), `${packCase.packId} install should write ${expectedFile}`);
    }

    const verifyFresh = runAtm(['agent-pack', 'verify-fresh', '--id', packCase.packId, '--cwd', tempRoot]);
    assert.equal(verifyFresh.exitCode, 0, `${packCase.packId} verify-fresh should exit 0`);
    assert.equal(verifyFresh.parsed.ok, true, `${packCase.packId} verify-fresh should report ok=true`);

    const diffClean = runAtm(['agent-pack', 'diff', '--id', packCase.packId, '--cwd', tempRoot]);
    assert.equal(diffClean.exitCode, 0, `${packCase.packId} diff should exit 0`);
    assert.equal(diffClean.parsed.evidence.changedFiles.length, 0, `${packCase.packId} clean diff should have 0 changed files`);

    const modifiedFile = path.join(tempRoot, packCase.expectedFiles[0]);
    writeFileSync(modifiedFile, `${readFileSync(modifiedFile, 'utf8')}\n# user edit\n`, 'utf8');
    const diffModified = runAtm(['agent-pack', 'diff', '--id', packCase.packId, '--cwd', tempRoot]);
    assert.equal(diffModified.exitCode, 0, `${packCase.packId} diff after edit should exit 0`);
    assert.equal(diffModified.parsed.evidence.changedFiles.length, 1, `${packCase.packId} diff should report 1 changed file`);
    assert.equal(diffModified.parsed.evidence.changedFiles[0].status, 'modified', `${packCase.packId} changed file should be modified`);

    const uninstall = runAtm(['agent-pack', 'uninstall', '--id', packCase.packId, '--cwd', tempRoot]);
    assert.equal(uninstall.exitCode, 0, `${packCase.packId} uninstall should exit 0`);
    assert.equal(uninstall.parsed.ok, true, `${packCase.packId} uninstall should report ok=true`);
    assert.ok(!existsSync(manifestPath), `${packCase.packId} uninstall should remove manifest`);
    assert.ok(existsSync(`${modifiedFile}.bak`), `${packCase.packId} uninstall should back up user-modified file`);
  } finally {
    await import('node:fs').then(({ rmSync }) => rmSync(tempRoot, { recursive: true, force: true }));
  }
}

console.log(`[agent-pack:multi] ok (${packCases.length} packs install/diff/verify-fresh/uninstall verified)`);

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