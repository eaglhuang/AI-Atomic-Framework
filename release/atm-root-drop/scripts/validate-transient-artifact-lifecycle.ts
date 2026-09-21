import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commands = [
  'packages/core/src/governance/operation-cleanup-contract.test.ts',
  'tests/cli/transient-artifact-lifecycle.test.ts'
];

for (const target of commands) {
  const result = spawnSync(process.execPath, ['--strip-types', target], { cwd: root, encoding: 'utf8', stdio: 'inherit' });
  if ((result.status ?? 1) !== 0) {
    console.error(`[transient-artifact-lifecycle] FAIL ${target}`);
    process.exit(result.status ?? 1);
  }
}

console.log('[transient-artifact-lifecycle] ok');
