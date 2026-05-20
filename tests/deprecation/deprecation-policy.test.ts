import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// --- TC-0: existing baseline checks ---

const blocked = runNode(['scripts/validate-deprecation-policy.ts', '--mode', 'test', '--fixture', 'tests/deprecation/time-not-ready.json']);
assert.equal(blocked.exitCode, 1, blocked.output);
assert.match(blocked.output, /DEPRECATION_TIME_NOT_READY/);

const valid = runNode(['scripts/validate-deprecation-policy.ts', '--mode', 'test', '--fixture', 'tests/deprecation/valid-deprecations.json']);
assert.equal(valid.exitCode, 0, valid.output);

const validator = runNode(['scripts/validate-deprecation-policy.ts', '--mode', 'test']);
assert.equal(validator.exitCode, 0, validator.output);

// --- TC-1: minor gate blocks even when time has elapsed (DEPRECATION_MINOR_NOT_READY only) ---
// Fixture: stable tier, 198d elapsed (>= 180 ✓), 2 minor lag (< 3 ✗)
const minorNotReady = runNode(['scripts/validate-deprecation-policy.ts', '--mode', 'test', '--fixture', 'tests/deprecation/minor-not-ready.json']);
assert.equal(minorNotReady.exitCode, 1, minorNotReady.output);
assert.match(minorNotReady.output, /DEPRECATION_MINOR_NOT_READY/);
assert.doesNotMatch(minorNotReady.output, /DEPRECATION_TIME_NOT_READY/, 'TC-1: time gate must NOT fire when time has elapsed');

// --- TC-2: both gates fail simultaneously (no short-circuit) ---
// Fixture: stable tier, 100d elapsed (< 180 ✗), 1 minor lag (< 3 ✗)
const bothFail = runNode(['scripts/validate-deprecation-policy.ts', '--mode', 'test', '--fixture', 'tests/deprecation/both-gates-fail.json']);
assert.equal(bothFail.exitCode, 1, bothFail.output);
assert.match(bothFail.output, /DEPRECATION_TIME_NOT_READY/, 'TC-2: time gate must fire');
assert.match(bothFail.output, /DEPRECATION_MINOR_NOT_READY/, 'TC-2: minor gate must also fire (no short-circuit)');

const tempRoot = createTempWorkspace('atm-deprecation-canary-');
try {
  const repo = path.join(tempRoot, 'repo');
  mkdirSync(repo, { recursive: true });
  assert.equal(runAtm(['bootstrap', '--cwd', repo, '--json'], repo).exitCode, 0);
  assert.equal(runAtm(['atm-chart', 'render', '--cwd', repo, '--json'], repo).exitCode, 0);
  const planPath = path.join(repo, '.atm', 'history', 'reports', 'upgrade-plan.json');
  const plan = runAtm(['upgrade', 'plan', '--cwd', repo, '--out', planPath, '--json'], repo);
  assert.equal(plan.exitCode, 0, plan.output);

  // --- original canary 25% smoke (pre-existing) ---
  const apply25 = runAtm(['upgrade', 'apply', '--cwd', repo, '--from-plan', planPath, '--canary', '25', '--json'], repo);
  assert.equal(apply25.exitCode, 0, apply25.output);
  assert.equal(apply25.parsed.messages[0].code, 'ATM_UPGRADE_CANARY_APPLIED');
  assert.equal(apply25.parsed.evidence.canary.percent, 25);
  assert.equal(apply25.parsed.evidence.canary.selectedFiles.length, 1);
  assert.equal(existsSync(path.join(repo, apply25.parsed.evidence.canary.statePath)), true);
  assert.equal(existsSync(path.join(repo, '.atm', 'runtime', 'compatibility-matrix.snapshot.json')), false);
  const rollback25 = runAtm(['upgrade', 'rollback', '--cwd', repo, '--backup', apply25.parsed.evidence.backupPath, '--json'], repo);
  assert.equal(rollback25.exitCode, 0, rollback25.output);
  assert.equal(rollback25.parsed.evidence.canaryRollback, true);

  // --- TC-3: canary 100% selects every willModify file (no deferred) ---
  const totalFiles = plan.parsed.evidence?.plan?.willModify?.length ?? 0;
  const apply100 = runAtm(['upgrade', 'apply', '--cwd', repo, '--from-plan', planPath, '--canary', '100', '--json'], repo);
  assert.equal(apply100.exitCode, 0, apply100.output);
  assert.equal(apply100.parsed.messages[0].code, 'ATM_UPGRADE_CANARY_APPLIED', 'TC-3: canary 100% must still report CANARY_APPLIED');
  assert.equal(apply100.parsed.evidence.canary.percent, 100);
  assert.equal(apply100.parsed.evidence.canary.deferredFiles.length, 0, 'TC-3: canary 100% must have zero deferred files');
  assert.equal(apply100.parsed.evidence.canary.selectedFiles.length, totalFiles, 'TC-3: canary 100% must select all willModify files');
  const rollback100 = runAtm(['upgrade', 'rollback', '--cwd', repo, '--backup', apply100.parsed.evidence.backupPath, '--json'], repo);
  assert.equal(rollback100.exitCode, 0, rollback100.output);

  // --- TC-4a: canary 0% is rejected (out of [1,100] range) ---
  const applyZero = runAtm(['upgrade', 'apply', '--cwd', repo, '--from-plan', planPath, '--canary', '0', '--json'], repo);
  assert.equal(applyZero.exitCode, 2, `TC-4a: --canary 0 must exit 2, got ${applyZero.output}`);
  assert.match(applyZero.output, /ATM_UPGRADE_CANARY_PERCENT_INVALID/, 'TC-4a: must report CANARY_PERCENT_INVALID');

  // --- TC-4b: canary 101% is rejected (out of [1,100] range) ---
  const apply101 = runAtm(['upgrade', 'apply', '--cwd', repo, '--from-plan', planPath, '--canary', '101', '--json'], repo);
  assert.equal(apply101.exitCode, 2, `TC-4b: --canary 101 must exit 2, got ${apply101.output}`);
  assert.match(apply101.output, /ATM_UPGRADE_CANARY_PERCENT_INVALID/, 'TC-4b: must report CANARY_PERCENT_INVALID');

  // --- TC-4c: --canary is not valid on non-apply actions ---
  const planWithCanary = runAtm(['upgrade', 'plan', '--cwd', repo, '--out', planPath, '--canary', '50', '--json'], repo);
  assert.equal(planWithCanary.exitCode, 2, `TC-4c: --canary on plan must exit 2, got ${planWithCanary.output}`);
  assert.match(planWithCanary.output, /ATM_CLI_USAGE/, 'TC-4c: must report ATM_CLI_USAGE');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[deprecation-policy-test] ok');

function runNode(args: readonly string[]) {
  const result = spawnSync(process.execPath, ['--strip-types', ...args.map((arg, index) => index === 0 ? path.join(root, arg) : arg)], {
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