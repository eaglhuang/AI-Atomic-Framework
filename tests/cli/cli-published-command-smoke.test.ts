import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const output = execFileSync(process.execPath, [
  '--strip-types', path.join(root, 'scripts', 'validate-candidate-npm-install.ts'), '--measurement-runs', '1'
], { cwd: root, encoding: 'utf8', windowsHide: true });
const proof = JSON.parse(output.trim().split(/\r?\n/).at(-1)!);
const source = readFileSync(path.join(root, 'scripts', 'validate-candidate-npm-install.ts'), 'utf8');

assert.equal(proof.schemaId, 'atm.candidateNpmInstallProof.v1');
assert.equal(proof.validation.cleanConsumer, true);
assert.equal(proof.validation.usedWorkspaceLink, false);
assert.equal(proof.validation.versionOnlySmoke, false);
assert.equal(proof.validation.commandMatrixComplete, true);
assert.equal(proof.validation.moduleResolutionFailures, 0);
assert.equal(proof.validation.passed, true);
// The matrix is whatever the candidate gate declares; pinning a literal list
// here let the gate and this test drift apart.
const declaredMatrix = [...source.matchAll(/const candidateSmokeCommandNames = \[([^\]]+)\]/g)]
  .flatMap((match) => [...match[1].matchAll(/'([a-z-]+)'/g)].map((entry) => entry[1]));
assert.ok(declaredMatrix.length > 0, 'the candidate gate must declare its smoke matrix');
assert.deepEqual([...proof.validation.commandMatrix].sort(), [...declaredMatrix].sort());
assert.ok(proof.validation.commandMatrix.includes('create'), 'the candidate gate must exercise atm create');

assert.match(source, /--candidate-tarball/);
assert.match(source, /--ignore-scripts/);
assert.match(source, /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/);
assert.match(source, /atm\.candidateNpmInstallProof\.v1/);
console.log('[cli-published-command-smoke] ok');
