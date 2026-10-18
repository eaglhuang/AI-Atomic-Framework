import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cases = [
  'tests/core/broker-native-serial-queue.test.ts',
  'tests/cli/broker-native-serial-queue.test.ts',
  'tests/cli/broker-native-serial-concurrency.test.ts'
];
for (const test of cases) {
  const result = spawnSync(process.execPath, ['--strip-types', test], { cwd: root, encoding: 'utf8', timeout: 90_000 });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.status !== 0 || result.error) {
    console.error(`Native serial queue validator failed: ${test}`);
    process.exitCode = 1;
    break;
  }
}
