import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTelemetryPayload, readTelemetryState, recordTelemetryEvent, setTelemetryEnabled } from '../../packages/cli/src/telemetry/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-telemetry-'));

let requestCount = 0;
const payload = createTelemetryPayload({ commandName: 'welcome', result: 'success', chartStatus: 'supported' });
const disabled = await recordTelemetryEvent(tempRoot, payload, () => { requestCount += 1; });
assert.equal(disabled.sent, false);
assert.equal(requestCount, 0);
assert.equal(readTelemetryState(tempRoot).enabled, false);

setTelemetryEnabled(tempRoot, true, 'https://telemetry.invalid/collect');
const sent = await recordTelemetryEvent(tempRoot, payload, (event) => {
  requestCount += 1;
  assert.deepEqual(Object.keys(event).sort(), ['chartStatus', 'cliVersion', 'commandName', 'nodeVersion', 'osFamily', 'result', 'schemaVersion'].sort());
});
assert.equal(sent.sent, true);
assert.equal(requestCount, 1);

const status = runAtm(['telemetry', '--cwd', tempRoot, '--status', '--json']);
assert.equal(status.exitCode, 0);
assert.equal(status.parsed.evidence.enabled, true);
assert.deepEqual(status.parsed.evidence.allowedFields, ['cliVersion', 'nodeVersion', 'osFamily', 'chartStatus', 'commandName', 'result']);

const off = runAtm(['telemetry', '--cwd', tempRoot, '--off', '--json']);
assert.equal(off.exitCode, 0);
assert.equal(off.parsed.evidence.enabled, false);

const welcomeRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-telemetry-welcome-'));
assert.equal(runAtm(['bootstrap', '--cwd', welcomeRoot, '--json']).exitCode, 0);
assert.equal(runAtm(['atm-chart', 'render', '--cwd', welcomeRoot, '--json']).exitCode, 0);
const welcome = runAtm(['welcome', '--cwd', welcomeRoot, '--dry-run', '--json']);
assert.equal(welcome.exitCode, 0);
assert.equal(welcome.parsed.evidence.telemetry.enabled, false);
assert.equal(welcome.parsed.messages.some((entry: any) => entry.code === 'ATM_TELEMETRY_NOTICE'), true);

console.log('[telemetry-test] ok');

function runAtm(args: readonly string[]) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  const output = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 1,
    parsed: JSON.parse(output)
  };
}
