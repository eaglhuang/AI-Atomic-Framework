import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(label: string, relativeScriptPath: string) {
  const target = path.join(root, relativeScriptPath);
  const result = spawnSync(process.execPath, ['--experimental-strip-types', target], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

run('git-admission-cli', path.join('tests', 'cli', 'git-admission-cli.test.ts'));
run('git-format-adapter-bridge', path.join('tests', 'cli', 'git-format-adapter-bridge.test.ts'));
run('validate-git-boundary-evidence', path.join('scripts', 'validate-git-boundary-evidence.ts'));

console.log('[validate-git-boundary-fixtures] ok');
