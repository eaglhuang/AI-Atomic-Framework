// 執行共用收件匣的跨程序測試。CI 的 test profile 會呼叫這個驗證器。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testPath = path.join(root, 'packages/core/src/broker/__tests__/shared-compose-inbox.test.ts');
const major = Number(process.versions.node.split('.')[0] ?? '0');
const flag = major >= 24 ? '--strip-types' : '--experimental-strip-types';
const result = spawnSync(process.execPath, [flag, testPath], { cwd: root, stdio: 'inherit' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
