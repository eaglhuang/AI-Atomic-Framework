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
assert.match(validatorSource, /resolvePublishedLatest\(packageName\)/, 'public npm validator must resolve the registry latest tag when no version is supplied');
assert.match(validatorSource, /dist-tags\.latest/, 'public npm validator must derive its default from the registry dist-tag');
assert.match(validatorSource, /\['dist\.tarball'\]/, 'validator must accept npm view flat dist.tarball metadata');
assert.match(validatorSource, /shell: process\.platform === 'win32'/, 'validator must execute Windows .cmd bins through the shell');
assert.match(validatorSource, /dist\.unpackedSize/, 'validator must read public unpacked size metadata');
assert.match(validatorSource, /maxPackedBytes/, 'validator must enforce the declared artifact byte budget');
assert.match(validatorSource, /maxPackedEntries/, 'validator must enforce the declared artifact entry budget');
assert.match(validatorSource, /runSmoke\(tarball/, 'public npm validator must execute the installed tarball smoke matrix');
assert.match(validatorSource, /versionOnlySmoke: false/, 'public npm validator must reject version-only evidence');
assert.match(validatorSource, /commandMatrixComplete/, 'public npm validator must report complete command-matrix coverage');

const candidateValidatorSource = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../../scripts/validate-candidate-npm-install.ts', import.meta.url), 'utf8'));
assert.match(candidateValidatorSource, /--candidate-tarball/, 'candidate validator must accept an explicit tarball');
assert.match(candidateValidatorSource, /atm\.candidateNpmInstallProof\.v1/, 'candidate validator must use a separate receipt schema');
assert.match(candidateValidatorSource, /versionOnlySmoke: false/, 'candidate validator must reject version-only evidence');
assert.match(candidateValidatorSource, /moduleResolutionFailures/, 'candidate validator must report module-resolution failures');
assert.match(candidateValidatorSource, /usedWorkspaceLink: false/, 'candidate validator must prove a tarball install rather than a workspace link');

const verified = execFileSync(npm, ['run', 'validate:public-npm-install', '--', '--package', '@ai-atomic-framework/cli', '--version', '0.1.0', '--measurement-runs', '1'], { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
const verifiedProof = JSON.parse(verified.trim().split(/\r?\n/).at(-1)!);
assert.equal(verifiedProof.status, 'verified');
assert.equal(verifiedProof.validation.cleanConsumer, true);
assert.equal(verifiedProof.validation.usedWorkspaceLink, false);
assert.equal(verifiedProof.validation.versionOnlySmoke, false);
assert.equal(verifiedProof.validation.commandMatrixComplete, true);
assert.equal(verifiedProof.validation.moduleResolutionFailures, 0);
assert.equal(verifiedProof.validation.allCommandsExecuted, true);
assert.equal(verifiedProof.validation.passed, true);

const oversized = execFileSync(npm, ['run', 'validate:public-npm-install', '--', '--package', '@ai-atomic-framework/cli', '--version', '0.1.0-beta.4', '--record-blocked'], { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
const oversizedProof = JSON.parse(oversized.trim().split(/\r?\n/).at(-1)!);
assert.equal(oversizedProof.status, 'blocked');
assert.match(String(oversizedProof.error ?? oversizedProof.blockedReason), /budget/i, 'over-budget public package must fail closed');

let failedClosed = false;
try { execFileSync(npm, args.slice(0, -1), { encoding: 'utf8', windowsHide: true, stdio: 'pipe', shell: process.platform === 'win32' }); } catch { failedClosed = true; }
assert.equal(failedClosed, true, 'unpublished package must fail closed without --record-blocked');
console.log('[public-npm-install-contract] ok');
