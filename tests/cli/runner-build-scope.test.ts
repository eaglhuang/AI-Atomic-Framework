import { execFileSync } from 'node:child_process';

execFileSync(process.execPath, [
  '--strip-types',
  'scripts/validate-runner-build-scope.ts',
  '--mode',
  'validate'
], {
  cwd: process.cwd(),
  stdio: 'inherit'
});

console.log('[runner-build-scope.test] ok');
