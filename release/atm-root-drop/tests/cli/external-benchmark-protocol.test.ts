import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalJson, canonicalJsonSha256 } from '../../scripts/lib/external-benchmark/runner.ts';

const root = process.cwd();
const validator = path.join(root, 'scripts', 'validate-external-benchmark-protocol.ts');
const canonical = path.join(root, 'scripts', 'fixtures', 'atm-external-benchmark', 'manifest.json');

execFileSync(process.execPath, ['--strip-types', validator], { cwd: root, stdio: 'pipe' });

const blocked = spawnSync(process.execPath, ['--strip-types', validator], { cwd: root, encoding: 'utf8' });
assert.equal(blocked.status, 0, 'a manifest without a custodian acceptance must remain valid but blocked');
assert.match(blocked.stdout, /blocked:hiddenCorpusAcceptance/);

const invalid = JSON.parse(readFileSync(canonical, 'utf8'));
invalid.arms.baseline.executionMode = 'modeled-worktree';
const tempDirectory = mkdtempSync(path.join(os.tmpdir(), 'atm-external-benchmark-'));
const invalidManifest = path.join(tempDirectory, 'invalid-manifest.json');
writeFileSync(invalidManifest, JSON.stringify(invalid, null, 2), 'utf8');
const invalidRun = spawnSync(process.execPath, ['--strip-types', validator, '--manifest', invalidManifest], { cwd: root, encoding: 'utf8' });
assert.notEqual(invalidRun.status, 0, 'a modeled baseline must fail the protocol validator');
assert.match(`${invalidRun.stdout}${invalidRun.stderr}`, /schema validation failed|baseline must use a real Git worktree/);

const eligible = JSON.parse(readFileSync(canonical, 'utf8'));
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const acceptancePayload = {
  schemaId: 'atm.hiddenCorpusAcceptance.v1',
  signerRole: 'hidden-corpus-custodian',
  signerId: eligible.oracle.hiddenCorpusOwner,
  protocolVersion: eligible.protocolVersion,
  protocolDigest: eligible.preregistrationDigest,
  corpusId: 'test-hidden-corpus',
  corpusDigest: canonicalJsonSha256({ fixture: 'hidden-corpus' }),
  visibility: 'oracle-only',
  acceptedAt: '2026-08-30T00:00:00.000Z'
};
const acceptance = {
  ...acceptancePayload,
  publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  signature: sign(null, Buffer.from(canonicalJson(acceptancePayload)), privateKey).toString('base64')
};
const acceptancePath = path.join(tempDirectory, 'hidden-corpus-acceptance.json');
writeFileSync(acceptancePath, JSON.stringify(acceptance, null, 2), 'utf8');
eligible.executionPrerequisites.hiddenCorpusAcceptance = {
  sealed: true,
  evidenceDigest: canonicalJsonSha256(acceptance),
  artifactPath: acceptancePath
};
eligible.runEligibility = { phase: 'pre-run', eligible: true, blockingReasons: [] };
const eligibleManifest = path.join(tempDirectory, 'eligible-manifest.json');
writeFileSync(eligibleManifest, JSON.stringify(eligible, null, 2), 'utf8');
const eligibleRun = spawnSync(process.execPath, ['--strip-types', validator, '--manifest', eligibleManifest], { cwd: root, encoding: 'utf8' });
assert.equal(eligibleRun.status, 0, `${eligibleRun.stdout}${eligibleRun.stderr}`);
assert.match(eligibleRun.stdout, /execution=eligible/);

console.log('external-benchmark-protocol ok');
