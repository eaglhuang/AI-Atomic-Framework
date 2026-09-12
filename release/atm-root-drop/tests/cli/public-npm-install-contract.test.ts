import { execFileSync } from 'node:child_process';
import { strict as assert } from 'node:assert';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = ['run', 'validate:public-npm-install', '--', '--package', '@ai-atomic-framework/cli', '--version', '0.0.0-does-not-exist', '--record-blocked'];
const output = execFileSync(npm, args, { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
const proof = JSON.parse(output.trim().split(/\r?\n/).at(-1)!);
assert.equal(proof.schemaId, 'atm.publicNpmInstallProof.v1');
assert.equal(proof.status, 'blocked');
assert.equal(proof.publicRegistry, false);
assert.equal(proof.usedWorkspaceLink, undefined);

const validatorSource = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../../scripts/validate-public-npm-install.ts', import.meta.url), 'utf8'));
assert.match(validatorSource, /value\('--version', '0\.1\.0-beta\.5'\)/, 'public npm validator must default to the latest published beta train');
assert.match(validatorSource, /\['dist\.tarball'\]/, 'validator must accept npm view flat dist.tarball metadata');
assert.match(validatorSource, /shell: process\.platform === 'win32'/, 'validator must execute Windows .cmd bins through the shell');
assert.match(validatorSource, /dist\.unpackedSize/, 'validator must read public unpacked size metadata');
assert.match(validatorSource, /maxPackedBytes/, 'validator must enforce the declared artifact byte budget');
assert.match(validatorSource, /maxPackedEntries/, 'validator must enforce the declared artifact entry budget');

const oversized = execFileSync(npm, ['run', 'validate:public-npm-install', '--', '--package', '@ai-atomic-framework/cli', '--version', '0.1.0-beta.4', '--record-blocked'], { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
const oversizedProof = JSON.parse(oversized.trim().split(/\r?\n/).at(-1)!);
assert.equal(oversizedProof.status, 'blocked');
assert.match(String(oversizedProof.error ?? oversizedProof.blockedReason), /budget/i, 'over-budget public package must fail closed');

let failedClosed = false;
try { execFileSync(npm, args.slice(0, -1), { encoding: 'utf8', windowsHide: true, stdio: 'pipe', shell: process.platform === 'win32' }); } catch { failedClosed = true; }
assert.equal(failedClosed, true, 'unpublished package must fail closed without --record-blocked');
console.log('[public-npm-install-contract] ok');
