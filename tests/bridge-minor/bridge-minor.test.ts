import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { invokeExperimentalApi } from '../../packages/agent-pack-sdk/src/experimental/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

assert.throws(
  () => invokeExperimentalApi({ apiId: 'agent-pack-preview' }),
  /requires --allow-experimental/
);
assert.equal(invokeExperimentalApi({ apiId: 'agent-pack-preview', allowExperimental: true }).accepted, true);

const denied = runAtm(['upgrade', 'experimental-api', '--api', 'agent-pack-preview', '--json']);
assert.equal(denied.exitCode, 2, denied.output);
assert.equal(denied.parsed.messages[0].code, 'ATM_EXPERIMENTAL_API_REQUIRES_OPT_IN');

const allowed = runAtm(['upgrade', 'experimental-api', '--api', 'agent-pack-preview', '--allow-experimental', '--json']);
assert.equal(allowed.exitCode, 0, allowed.output);
assert.equal(allowed.parsed.evidence.experimental.accepted, true);
assert.equal(allowed.parsed.evidence.experimental.stability, 'experimental');

const validator = spawnSync(process.execPath, ['--strip-types', path.join(root, 'scripts/validate-bridge-minor.ts'), '--mode', 'test'], {
  cwd: root,
  encoding: 'utf8'
});
assert.equal(validator.status, 0, `${validator.stdout}\n${validator.stderr}`);

console.log('[bridge-minor-test] ok');

function runAtm(args: readonly string[]) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  const output = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 1,
    output,
    parsed: JSON.parse(output)
  };
}
