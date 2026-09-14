import { execFileSync, spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = ['run', 'validate:public-npm-install', '--', '--package', '@ai-atomic-framework/cli', '--version', '0.0.0-does-not-exist', '--record-blocked'];
const output = execFileSync(npm, args, { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
const proof = JSON.parse(output.trim().split(/\r?\n/).at(-1)!);
assert.equal(proof.schemaId, 'atm.publicNpmInstallProof.v1');
assert.equal(proof.status, 'blocked');
assert.equal(proof.publicRegistry, false);
assert.equal(proof.usedWorkspaceLink, undefined);

const validatorSource = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../../scripts/validate-public-npm-install.ts', import.meta.url), 'utf8'));
assert.match(validatorSource, /resolvePublishedLatest\(packageName\)/, 'public npm validator must resolve the registry latest tag when no version is supplied');
assert.match(validatorSource, /dist-tags\.latest/, 'public npm validator must derive its default from the registry dist-tag');
assert.match(validatorSource, /\['dist\.tarball'\]/, 'validator must accept npm view flat dist.tarball metadata');
assert.match(validatorSource, /shell: process\.platform === 'win32'/, 'validator must execute Windows .cmd bins through the shell');
assert.match(validatorSource, /dist\.unpackedSize/, 'validator must read public unpacked size metadata');
assert.match(validatorSource, /maxPackedBytes/, 'validator must enforce the declared artifact byte budget');
assert.match(validatorSource, /maxPackedEntries/, 'validator must enforce the declared artifact entry budget');
assert.match(validatorSource, /runSmoke\(tarball/, 'public npm validator must execute the installed tarball smoke matrix');
assert.match(validatorSource, /versionOnlySmoke: false/, 'public npm validator must reject version-only evidence');
assert.match(validatorSource, /commandMatrixComplete/, 'public npm validator must report complete command-matrix coverage');
assert.match(validatorSource, /atm-chart-render/, 'public npm validator must exercise chart rendering');
assert.match(validatorSource, /atm-chart-verify/, 'public npm validator must exercise chart verification');
assert.match(validatorSource, /requiredSuccessCommandFailures/, 'public npm validator must report required command failures');
assert.match(validatorSource, /coreWorkflowPassed/, 'public npm validator must report core workflow status');

const candidateValidatorSource = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../../scripts/validate-candidate-npm-install.ts', import.meta.url), 'utf8'));
assert.match(candidateValidatorSource, /--candidate-tarball/, 'candidate validator must accept an explicit tarball');
assert.match(candidateValidatorSource, /atm\.candidateNpmInstallProof\.v1/, 'candidate validator must use a separate receipt schema');
assert.match(candidateValidatorSource, /versionOnlySmoke: false/, 'candidate validator must reject version-only evidence');
assert.match(candidateValidatorSource, /moduleResolutionFailures/, 'candidate validator must report module-resolution failures');
assert.match(candidateValidatorSource, /usedWorkspaceLink: false/, 'candidate validator must prove a tarball install rather than a workspace link');

const live = execFileSync(npm, ['run', 'validate:public-npm-install', '--', '--package', '@ai-atomic-framework/cli', '--version', '0.1.0', '--record-blocked', '--measurement-runs', '1'], { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
const liveProof = JSON.parse(live.trim().split(/\r?\n/).at(-1)!);
assert.equal(liveProof.validation.cleanConsumer, true);
assert.equal(liveProof.validation.usedWorkspaceLink, false);
assert.equal(liveProof.validation.versionOnlySmoke, false);
assert.equal(liveProof.validation.commandMatrixComplete, true);
assert.deepEqual(liveProof.validation.requiredSuccessCommands, ['version', 'doctor', 'bootstrap', 'atm-chart-render', 'atm-chart-verify']);
assert.equal(liveProof.validation.moduleResolutionFailures, 0);
assert.equal(liveProof.validation.allCommandsExecuted, true);
if (liveProof.status === 'verified') {
  assert.equal(liveProof.validation.coreWorkflowPassed, true);
  assert.equal(liveProof.validation.passed, true);
} else {
  assert.equal(liveProof.status, 'blocked');
  assert.equal(liveProof.validation.coreWorkflowPassed, false);
  assert.equal(liveProof.validation.passed, false);
  assert.ok(liveProof.validation.requiredSuccessCommandFailures.length > 0);
}

const oversized = execFileSync(npm, ['run', 'validate:public-npm-install', '--', '--package', '@ai-atomic-framework/cli', '--version', '0.1.0-beta.4', '--record-blocked'], { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
const oversizedProof = JSON.parse(oversized.trim().split(/\r?\n/).at(-1)!);
assert.equal(oversizedProof.status, 'blocked');
assert.match(String(oversizedProof.error ?? oversizedProof.blockedReason), /budget/i, 'over-budget public package must fail closed');

let failedClosed = false;
try { execFileSync(npm, args.slice(0, -1), { encoding: 'utf8', windowsHide: true, stdio: 'pipe', shell: process.platform === 'win32' }); } catch { failedClosed = true; }
assert.equal(failedClosed, true, 'unpublished package must fail closed without --record-blocked');

// A registry smoke cannot prove a not-yet-published candidate. Pack the local
// runtime, install it into an isolated consumer, and exercise the first
// post-bootstrap chart lifecycle so missing data assets cannot hide behind a
// version-only or module-resolution check.
const localSmokeRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-public-runtime-chart-'));
try {
  const packed = JSON.parse(execFileSync(npm, [
    'pack', '--workspace', '@ai-atomic-framework/cli', '--ignore-scripts', '--pack-destination', localSmokeRoot,
    '--json', '--loglevel', 'silent'
  ], { cwd: root, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' }).trim());
  const tarball = path.join(localSmokeRoot, packed[0].filename);
  const consumer = path.join(localSmokeRoot, 'consumer');
  const adopter = path.join(consumer, 'adopter');
  mkdirSync(adopter, { recursive: true });
  execFileSync(npm, ['install', '--ignore-scripts', '--no-save', '--prefix', consumer, tarball], {
    cwd: localSmokeRoot, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32'
  });
  const entrypoint = path.join(consumer, 'node_modules', '@ai-atomic-framework', 'cli', 'dist', 'npm-runtime', 'atm.mjs');
  assert.ok(existsSync(entrypoint), 'local candidate install must expose the frozen atm entrypoint');
  const runAtm = (...args: string[]) => {
    const result = spawnSync(process.execPath, [entrypoint, ...args], { cwd: adopter, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, `local candidate ${args.join(' ')} failed: ${result.stdout}${result.stderr}`);
    return `${result.stdout}${result.stderr}`;
  };
  runAtm('bootstrap', '--cwd', adopter, '--task', 'public runtime chart smoke', '--json');
  runAtm('atm-chart', 'render', '--cwd', adopter, '--json');
  runAtm('atm-chart', 'verify', '--cwd', adopter, '--json');
  const installedLayout = path.join(consumer, 'node_modules', '@ai-atomic-framework', 'cli', 'dist', 'npm-runtime', 'layout');
  for (const schemaPath of [
    'schemas/governance/default-guards.schema.json',
    'schemas/charter/charter-invariants.schema.json',
    'schemas/integrations/install-manifest.schema.json',
    'schemas/agent-prompt.schema.json',
    'schemas/upgrade/upgrade-proposal.schema.json'
  ]) {
    assert.ok(existsSync(path.join(installedLayout, schemaPath)), `local candidate runtime must carry ${schemaPath}`);
  }
  const chart = readFileSync(path.join(adopter, '.atm', 'memory', 'atm-chart.md'), 'utf8');
  for (const schemaId of ['governance/default-guards', 'charter/charter-invariants', 'integrations/install-manifest', 'agent-prompt', 'upgrade/upgrade-proposal']) {
    assert.match(chart, new RegExp(schemaId.replace('/', '\\/')), `rendered ATMChart must record ${schemaId}`);
  }
} finally {
  rmSync(localSmokeRoot, { recursive: true, force: true });
}
console.log('[public-npm-install-contract] ok');
