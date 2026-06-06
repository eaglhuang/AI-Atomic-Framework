import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixturePath = path.join(root, 'tests', 'known-bad', 'current-version-known-bad.json');

const blockedCreate = runAtm(['create', '--bucket', 'CORE', '--json']);
assert.equal(blockedCreate.exitCode, 1);
assert.equal(blockedCreate.parsed.ok, false);
assert.equal(blockedCreate.parsed.messages[0].code, 'ATM_KNOWN_BAD_VERSION_BLOCKED');
assert.equal(blockedCreate.parsed.evidence.knownBadStatus.match.replacementVersion, '0.0.1');
assert.match(blockedCreate.parsed.evidence.knownBadStatus.match.reasonSummary, /current CLI version is marked known-bad/);

const doctor = runAtm(['doctor', '--known-bad', '--json']);
assert.equal(doctor.parsed.evidence.knownBadStatus.mode, 'known-bad');
assert.equal(doctor.parsed.evidence.knownBadStatus.match.replacementVersion, '0.0.1');
assert.match(doctor.parsed.evidence.knownBadStatus.match.reasonSummary, /current CLI version is marked known-bad/);

const migratePlan = runAtm(['migrate', 'plan', '--from', '0.0.1', '--to', '0.1.0', '--json']);
assert.notEqual(migratePlan.parsed.messages?.[0]?.code, 'ATM_KNOWN_BAD_VERSION_BLOCKED');

console.log('[known-bad:test] ok (deny-write block + doctor diagnosis + read-only plan allowed)');

function runAtm(args: readonly string[]) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ATM_KNOWN_BAD_VERSIONS_PATH: fixturePath,
      ATM_KNOWN_BAD_VERSION: '0.0.0'
    }
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 1,
    parsed: JSON.parse(payload || '{}'),
    stdout: result.stdout,
    stderr: result.stderr
  };
}
