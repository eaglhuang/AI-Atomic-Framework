import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const blocked = runNode(['scripts/validate-deprecation-policy.ts', '--mode', 'test', '--fixture', 'tests/deprecation/time-not-ready.json']);
assert.equal(blocked.exitCode, 1, blocked.output);
assert.match(blocked.output, /DEPRECATION_TIME_NOT_READY/);

const valid = runNode(['scripts/validate-deprecation-policy.ts', '--mode', 'test', '--fixture', 'tests/deprecation/valid-deprecations.json']);
assert.equal(valid.exitCode, 0, valid.output);

const validator = runNode(['scripts/validate-deprecation-policy.ts', '--mode', 'test']);
assert.equal(validator.exitCode, 0, validator.output);

const tempRoot = createTempWorkspace('atm-deprecation-canary-');
try {
  const repo = path.join(tempRoot, 'repo');
  mkdirSync(repo, { recursive: true });
  assert.equal(runAtm(['bootstrap', '--cwd', repo, '--json'], repo).exitCode, 0);
  assert.equal(runAtm(['atm-chart', 'render', '--cwd', repo, '--json'], repo).exitCode, 0);
  const planPath = path.join(repo, '.atm', 'history', 'reports', 'upgrade-plan.json');
  const plan = runAtm(['upgrade', 'plan', '--cwd', repo, '--out', planPath, '--json'], repo);
  assert.equal(plan.exitCode, 0, plan.output);
  const apply = runAtm(['upgrade', 'apply', '--cwd', repo, '--from-plan', planPath, '--canary', '25', '--json'], repo);
  assert.equal(apply.exitCode, 0, apply.output);
  assert.equal(apply.parsed.messages[0].code, 'ATM_UPGRADE_CANARY_APPLIED');
  assert.equal(apply.parsed.evidence.canary.percent, 25);
  assert.equal(apply.parsed.evidence.canary.selectedFiles.length, 1);
  assert.equal(existsSync(path.join(repo, apply.parsed.evidence.canary.statePath)), true);
  assert.equal(existsSync(path.join(repo, '.atm', 'runtime', 'compatibility-matrix.snapshot.json')), false);
  const rollback = runAtm(['upgrade', 'rollback', '--cwd', repo, '--backup', apply.parsed.evidence.backupPath, '--json'], repo);
  assert.equal(rollback.exitCode, 0, rollback.output);
  assert.equal(rollback.parsed.evidence.canaryRollback, true);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[deprecation-policy-test] ok');

function runNode(args: readonly string[]) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', ...args.map((arg, index) => index === 0 ? path.join(root, arg) : arg)], {
    cwd: root,
    encoding: 'utf8'
  });
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`.trim()
  };
}

function runAtm(args: readonly string[], cwd = root) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd,
    encoding: 'utf8'
  });
  const output = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 1,
    output,
    parsed: output ? JSON.parse(output) : null
  };
}