/**
 * Integration tests for `atm migrate` command.
 *
 * These tests run the CLI end-to-end against the bundled fixture and verify
 * that the migrate plan / apply / verify workflow produces correct JSON output.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function runAtm(args: readonly string[], cwd = root) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd,
    encoding: 'utf8'
  });
  const payload = (result.stdout || '').trim();
  let parsed: any = {};
  try {
    parsed = payload ? JSON.parse(payload) : {};
  } catch {
    // leave empty — test assertions will catch it
  }
  return { exitCode: result.status ?? 1, parsed, stdout: result.stdout, stderr: result.stderr };
}

// ---------------------------------------------------------------------------
// migrate --help
// ---------------------------------------------------------------------------

const helpResult = runAtm(['migrate', '--help', '--json']);
console.assert(helpResult.exitCode === 0, `migrate --help must exit 0, got ${helpResult.exitCode}`);
console.assert(helpResult.parsed.ok === true, `migrate --help must return ok: true`);
console.assert(helpResult.parsed.evidence?.usage?.command === 'migrate', `migrate --help must return command: migrate`);

// ---------------------------------------------------------------------------
// migrate plan --from 0.0.1 --to 0.1.0 (no-match on real workspace is fine)
// ---------------------------------------------------------------------------

const planResult = runAtm(['migrate', 'plan', '--from', '0.0.1', '--to', '0.1.0', '--json']);
console.assert(planResult.exitCode === 0, `migrate plan must exit 0, got ${planResult.exitCode}`);
console.assert(planResult.parsed.ok === true, `migrate plan must return ok: true`);
console.assert(
  planResult.parsed.evidence?.fromVersion === '0.0.1',
  `migrate plan must echo fromVersion: 0.0.1`
);
console.assert(
  planResult.parsed.evidence?.toVersion === '0.1.0',
  `migrate plan must echo toVersion: 0.1.0`
);

// ---------------------------------------------------------------------------
// migrate plan --from 9.9.9 --to 9.9.10 (no migration defined)
// ---------------------------------------------------------------------------

const noMigrationResult = runAtm(['migrate', 'plan', '--from', '9.9.9', '--to', '9.9.10', '--json']);
console.assert(noMigrationResult.exitCode === 0, `migrate plan unknown versions must exit 0`);
console.assert(noMigrationResult.parsed.ok === true, 'migrate plan unknown versions must return ok: true');
console.assert(
  noMigrationResult.parsed.evidence?.status === 'no-migration-defined',
  `status must be no-migration-defined, got ${noMigrationResult.parsed.evidence?.status}`
);

// ---------------------------------------------------------------------------
// migrate verify --fixture fixtures/migrations/atm-chart-0.0.1-to-0.1.0
// ---------------------------------------------------------------------------

const verifyResult = runAtm([
  'migrate',
  'verify',
  '--fixture',
  'fixtures/migrations/atm-chart-0.0.1-to-0.1.0',
  '--json'
]);
console.assert(verifyResult.exitCode === 0, `migrate verify must exit 0, got ${verifyResult.exitCode}\n${verifyResult.stderr}`);
console.assert(verifyResult.parsed.ok === true, `migrate verify must return ok: true\n${verifyResult.stdout}`);
console.assert(
  verifyResult.parsed.evidence?.status === 'fixture-ok',
  `migrate verify evidence.status must be fixture-ok, got ${verifyResult.parsed.evidence?.status}`
);

// ---------------------------------------------------------------------------
// migrate apply in temp workspace
// ---------------------------------------------------------------------------

const tempDir = path.join(root, 'temp', `migrate-test-${Date.now().toString(36)}`);
mkdirSync(path.join(tempDir, '.atm', 'memory'), { recursive: true });
const fakeBefore = readFileSync(
  path.join(root, 'fixtures/migrations/atm-chart-0.0.1-to-0.1.0/before/atm-chart.md'),
  'utf8'
);
writeFileSync(path.join(tempDir, '.atm', 'memory', 'atm-chart.md'), fakeBefore, 'utf8');

const applyResult = runAtm(['migrate', 'apply', '--from', '0.0.1', '--to', '0.1.0', '--cwd', tempDir, '--json']);
console.assert(applyResult.exitCode === 0, `migrate apply must exit 0, got ${applyResult.exitCode}\n${applyResult.stderr}`);
console.assert(applyResult.parsed.ok === true, `migrate apply must return ok: true\n${applyResult.stdout}`);
console.assert(applyResult.parsed.evidence?.status === 'applied', `migrate apply evidence.status must be applied`);

const appliedContent = readFileSync(path.join(tempDir, '.atm', 'memory', 'atm-chart.md'), 'utf8');
console.assert(
  appliedContent.includes('atm_chart_version: 0.1.0'),
  `applied file must contain atm_chart_version: 0.1.0`
);

const backupPath: string = applyResult.parsed.evidence?.backupPath;
console.assert(
  typeof backupPath === 'string' && existsSync(path.join(backupPath, 'backup-manifest.json')),
  `apply must write backup-manifest.json`
);

// Cleanup
rmSync(tempDir, { recursive: true, force: true });

console.log('[migrate-command.test] ok — all assertions passed');
