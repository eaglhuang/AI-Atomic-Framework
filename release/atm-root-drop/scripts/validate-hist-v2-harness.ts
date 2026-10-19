// Runs the HIST-v2 harness v2 unit and fixture tests. It does not start a benchmark.
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harness = path.join(root, 'research/paper-v2/benchmark-harness/hist-v2-harness-v2');
const classifierSrc = path.join(root, 'research/paper-v2/benchmark-design/hist-v2-classifier-v8/src');
const pyTarget = mkdtempSync(path.join(tmpdir(), 'hist-v2-py-'));
const install = spawnSync(
  'python3',
  ['-m', 'pip', 'install', '--disable-pip-version-check', '--target', pyTarget, '-r', path.join(harness, 'requirements.txt')],
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
  PYTHONPATH: [path.join(harness, 'src'), classifierSrc, pyTarget].join(path.delimiter)
};
const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', path.join(harness, 'tests'), '-v'], {
  cwd: harness,
  env,
  stdio: 'inherit'
});
if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

console.log('ok: validate-hist-v2-harness');
