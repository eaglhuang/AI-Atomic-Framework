// Runs the shared compose inbox coordinator tests on the test and standard profiles.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const major = Number(process.versions.node.split('.')[0] ?? '0');
const stripFlag = major >= 24 ? '--strip-types' : '--experimental-strip-types';
const files = [
  'packages/core/src/broker/__tests__/shared-compose-inbox.test.ts',
  'packages/core/src/broker/__tests__/shared-compose-inbox-time.test.ts'
];

for (const file of files) {
  const result = spawnSync(process.execPath, [stripFlag, path.join(root, file)], { stdio: 'inherit' });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('ok: validate-shared-compose-inbox');
