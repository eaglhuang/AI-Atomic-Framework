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

assert.equal(proof.schemaId, 'atm.candidateNpmInstallProof.v1');
assert.equal(proof.validation.cleanConsumer, true);
assert.equal(proof.validation.usedWorkspaceLink, false);
assert.equal(proof.validation.versionOnlySmoke, false);
assert.equal(proof.validation.commandMatrixComplete, true);
assert.equal(proof.validation.moduleResolutionFailures, 0);
assert.equal(proof.validation.passed, true);
assert.deepEqual(proof.validation.commandMatrix, ['version', 'next', 'tasks', 'doctor']);

const source = readFileSync(path.join(root, 'scripts', 'validate-candidate-npm-install.ts'), 'utf8');
assert.match(source, /--candidate-tarball/);
assert.match(source, /--ignore-scripts/);
assert.match(source, /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/);
assert.match(source, /atm\.candidateNpmInstallProof\.v1/);
console.log('[cli-published-command-smoke] ok');
