import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
execFileSync(process.execPath, ['--strip-types', 'scripts/validate-product-ci-burn-in-schedule.ts', '--mode', 'validate'], {
  cwd: root,
  stdio: 'inherit'
});
console.log('[product-ci-burn-in-schedule.test] ok');
