import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseAtmResultLine } from '../../scripts/lib/atm-result-line.ts';

const temp = mkdtempSync(path.join(os.tmpdir(), 'atm-build-log-'));
try {
  const module = pathToFileURL(fileURLToPath(new URL('../../scripts/sealed-build-log-sink.ts', import.meta.url))).href;
  const fixture = path.join(temp, 'fake-build.mjs');
  const log = path.join(temp, 'nested', 'build.log');
  writeFileSync(fixture, `import { withSealedBuildLog } from ${JSON.stringify(module)};
import { spawnSync } from 'node:child_process';
withSealedBuildLog();
console.log('build stdout');
console.error('build stderr');
spawnSync(process.execPath, ['-e', 'console.log("child stdout"); console.error("child stderr")'], { stdio: 'inherit' });
if (process.argv.includes('--fail')) {
  console.error(JSON.stringify({ message: 'packages step failed' }));
  process.exit(7);
}
`);
  const run = (args: string[], enabled: boolean) => spawnSync(process.execPath, ['--strip-types', fixture, ...args], {
    encoding: 'utf8', env: { ...process.env, ATM_BUILD_LOG_FILE: enabled ? log : '', ATM_BUILD_LOG_INNER: '' }
  });
  const plain = run([], false);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /build stdout/);
  assert.match(plain.stderr, /child stderr/);
  const success = run([], true);
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stderr, '');
  assert.equal(success.stdout.trim().split('\n').length, 1);
  assert.equal(parseAtmResultLine(success.stdout.trim())?.code, 'BUILD_OK');
  assert.match(readFileSync(log, 'utf8'), /build stdout[\s\S]*build stderr[\s\S]*child stdout[\s\S]*child stderr/);
  const before = readFileSync(log, 'utf8');
  const failure = run(['--fail', '--log-file', log], false);
  assert.equal(failure.status, 7);
  const result = parseAtmResultLine(failure.stdout.trim());
  assert.equal(result?.code, 'BUILD_STEP_FAILED');
  assert.match(result?.hint ?? '', /packages step failed; see log/);
  assert.ok(readFileSync(log, 'utf8').startsWith(before), 'log must append');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
console.log('[sealed-build-log-sink] ok');
