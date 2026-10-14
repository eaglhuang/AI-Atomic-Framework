// Runs the HIST-v2 smoke runbook unit tests. It does not start a benchmark.
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runbook = path.join(root, 'research/paper-v2/benchmark-design/hist-v2-smoke-runbook');
const harnessSrc = path.join(root, 'research/paper-v2/benchmark-harness/hist-v2-harness-v2/src');
const classifierSrc = path.join(root, 'research/paper-v2/benchmark-design/hist-v2-classifier-v8/src');
const pyTarget = mkdtempSync(path.join(tmpdir(), 'hist-v2-smoke-py-'));
const install = spawnSync(
  'python3',
  ['-m', 'pip', 'install', '--disable-pip-version-check', '--target', pyTarget, '-r', path.join(runbook, 'requirements.txt')],
  { stdio: 'inherit' }
);
if ((install.status ?? 1) !== 0) {
  process.exit(install.status ?? 1);
}

const env = {
  ...process.env,
  PYTHONDONTWRITEBYTECODE: '1',
  HIST_V2_REPO_ROOT: root,
  HIST_V2_PYTHONPATH: pyTarget,
  PYTHONPATH: [path.join(runbook, 'src'), harnessSrc, classifierSrc, pyTarget].join(path.delimiter)
};
const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', path.join(runbook, 'tests'), '-v'], {
  cwd: runbook,
  env,
  stdio: 'inherit'
});
if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

console.log('ok: validate-hist-v2-smoke-runbook');
