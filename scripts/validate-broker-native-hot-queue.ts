import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
for (const test of ['tests/core/broker-native-hot-queue.test.ts', 'tests/cli/broker-native-hot-queue.test.ts',
  'tests/cli/broker-native-hot-concurrency.test.ts']) {
  const result = spawnSync(process.execPath, ['--strip-types', test], { cwd: root, encoding: 'utf8', timeout: 90_000 });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  if (result.status !== 0 || result.error) {
    console.error(`Native hot queue validator failed: ${test}`);
    process.exitCode = 1;
    break;
  }
}
