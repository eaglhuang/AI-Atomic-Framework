import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function runNode(args: string[]) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8'
  });
}

const computeGate = runNode([
  path.join(root, 'tools_node/compute-gate.js'),
  '--gates',
  'ts-syntax',
  '--dry-run',
  '--json'
]);
assert.equal(computeGate.status, 0, computeGate.stderr);
const computeGatePayload = JSON.parse(computeGate.stdout);
assert.equal(computeGatePayload.ok, true);
assert.equal(computeGatePayload.runs?.[0]?.gate, 'ts-syntax');
assert.equal(computeGatePayload.runs?.[0]?.command, 'npm run typecheck');

const grepResult = runNode([
  '--strip-types',
  path.join(root, 'scripts/run-validators.ts'),
  'quick',
  '--grep',
  'permission broker'
]);
assert.notEqual(grepResult.status, 0, 'run-validators --grep must fail closed');
const grepOutput = `${grepResult.stdout}\n${grepResult.stderr}`;
assert.match(grepOutput, /--filter "permission broker"/);
assert.match(grepOutput, /--focus-path <path>/);

console.log('[validator-discoverability] ok');
