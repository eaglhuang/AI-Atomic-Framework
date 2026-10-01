import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The tracked release drops must run from a clean copy: every command answers
// with an ATM JSON envelope (never a raw Node module error), and onefile's
// bootstrap leaves welcome/next/doctor usable without a manual chart step.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function run(cwd: string, args: string[]) {
  const result = spawnSync(process.execPath, ['atm.mjs', ...args, '--json'], { cwd, encoding: 'utf8', timeout: 120_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(/ERR_MODULE_NOT_FOUND|Cannot find module/.test(output), false, `${args.join(' ')} hit a missing runtime module:\n${output.slice(0, 600)}`);
  const json = JSON.parse(output.slice(output.indexOf('{')));
  return { status: result.status, json };
}

function cleanCopy(source: string, label: string) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), `atm-${label}-`));
  cpSync(source, path.join(cwd, path.basename(source) === 'atm.mjs' ? 'atm.mjs' : ''), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd });
  return cwd;
}

{
  const cwd = cleanCopy(path.join(repoRoot, 'release', 'atm-onefile', 'atm.mjs'), 'onefile-smoke');
  try {
    assert.equal(run(cwd, ['next']).json.evidence?.nextAction?.status, 'needs-bootstrap');
    assert.equal(run(cwd, ['bootstrap']).status, 0);
    for (const command of ['welcome', 'next', 'doctor']) {
      const result = run(cwd, [command]);
      assert.equal(result.status, 0, `onefile ${command} after bootstrap: ${JSON.stringify(result.json.diagnostics)}`);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

{
  const cwd = cleanCopy(path.join(repoRoot, 'release', 'atm-root-drop'), 'root-drop-smoke');
  try {
    for (const command of ['next', 'bootstrap', 'welcome', 'next', 'doctor']) run(cwd, [command]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

console.log('ok: onefile and root-drop run from a clean copy');
