import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAtmResultLine } from '../../scripts/lib/atm-result-line.ts';
import { helpSnapshotDirectory } from '../../scripts/validate-cli/help-snapshots.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const temp = mkdtempSync(path.join(os.tmpdir(), 'atm-preclose-check-'));
const log = path.join(temp, 'logs', 'preclose.log');
const run = (script: string, args: string[] = []) => spawnSync(process.execPath, ['--strip-types', path.join(root, 'scripts', script), ...args], {
  cwd: temp, encoding: 'utf8'
});
try {
  cpSync(path.join(root, helpSnapshotDirectory), path.join(temp, helpSnapshotDirectory), { recursive: true });
  const pass = run('preclose-check.ts', ['--log-file', log]);
  assert.equal(pass.status, 0, pass.stderr);
  assert.equal(pass.stderr, '');
  assert.equal(pass.stdout.trim().split('\n').length, 1);
  assert.equal(parseAtmResultLine(pass.stdout.trim())?.code, 'PRECLOSE_OK');
  assert.match(readFileSync(log, 'utf8'), /"hardViolationCount":0/);

  mkdirSync(path.join(temp, 'packages'));
  const oversized = path.join(temp, 'packages', 'oversized.ts');
  writeFileSync(oversized, '// line\n'.repeat(601));
  const budget = run('preclose-check.ts', ['--log-file', log]);
  assert.equal(budget.status, 1, budget.stderr);
  const budgetResult = parseAtmResultLine(budget.stdout.trim());
  assert.equal(budgetResult?.code, 'LINE_BUDGET_EXCEEDED');
  assert.match(budgetResult?.hint ?? '', /packages\/oversized.ts has 601 lines > 600; split it/);
  rmSync(oversized);

  const broker = path.join(temp, helpSnapshotDirectory, 'broker.json');
  const original = readFileSync(broker, 'utf8');
  writeFileSync(broker, '{}\n');
  const drift = run('preclose-check.ts', ['--json', '--log-file', log]);
  assert.equal(drift.status, 1, drift.stderr);
  const driftResult = JSON.parse(drift.stdout);
  assert.equal(driftResult.code, 'HELP_SNAPSHOT_DRIFT');
  assert.match(driftResult.hint, /help snapshot drift: broker; run npm run help-snapshots:update/);

  const next = path.join(temp, helpSnapshotDirectory, 'next.json');
  writeFileSync(next, '{}\n');
  const update = run('update-help-snapshots.ts', ['--only', 'broker']);
  assert.equal(update.status, 0, update.stderr);
  const updateResult = parseAtmResultLine(update.stdout.trim());
  assert.equal(updateResult?.code, 'HELP_SNAPSHOTS_OK');
  assert.match(updateResult?.hint ?? '', /changed: tests\/cli-fixtures\/help-snapshots\/broker.json/);
  assert.equal(readFileSync(broker, 'utf8'), original);
  assert.equal(readFileSync(next, 'utf8'), '{}\n', '--only must preserve other snapshots');
  const repeat = run('update-help-snapshots.ts', ['--only', 'broker']);
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(parseAtmResultLine(repeat.stdout.trim())?.hint, 'no snapshot changes');
  const invalid = run('update-help-snapshots.ts', ['--only', '../outside']);
  assert.equal(invalid.status, 1, invalid.stderr);
  assert.equal(parseAtmResultLine(invalid.stdout.trim())?.code, 'HELP_SNAPSHOTS_FAILED');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
console.log('[preclose-check] ok');
