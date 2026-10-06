import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { digest, integrity, readReleaseManifest, verifyArtifact, type ReleaseManifest } from '../../scripts/release-artifact-manifest.ts';
import { runCandidateRelease, type CandidateIO, type CandidateReceipt } from '../../scripts/release-candidate.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-parity-'));
const source = { sourceCommit: 'a'.repeat(40), sourceDigest: 'b'.repeat(64) };
let cases = 0;
function test(name: string, fn: () => void) { fn(); cases++; console.log(`ok: ${name}`); }
try {
  const artifacts = ['@ai-atomic-framework/cli', 'create-atm'].map((name, index) => {
    const stage = path.join(root, `stage-${index}`);
    const dist = name === 'create-atm' ? 'dist' : 'dist/npm-runtime';
    mkdirSync(path.join(stage, 'package', dist), { recursive: true });
    writeFileSync(path.join(stage, 'package/package.json'), JSON.stringify({ name, version: '1.2.3', bin: name === 'create-atm' ? { 'create-atm': 'dist/index.js' } : { atm: 'dist/npm-runtime/atm.mjs' }, exports: { '.': { import: name === 'create-atm' ? './dist/index.js' : './dist/npm-runtime/index.js' } }, ...(name === 'create-atm' ? { dependencies: { '@ai-atomic-framework/cli': '1.2.3' } } : {}) }));
    const runtimeEntry = name === 'create-atm' ? 'index.js' : 'runtime.mjs';
    writeFileSync(path.join(stage, 'package', dist, runtimeEntry), 'runtime bytes');
    const content = { schemaId: 'atm.runtimeBuildIdentity.v1', ...source, packageName: name, version: '1.2.3', files: [{ path: runtimeEntry, sha256: digest('runtime bytes') }] };
    const buildId = digest(JSON.stringify(content));
    writeFileSync(path.join(stage, 'package', dist, 'build-identity.json'), JSON.stringify({ ...content, buildId }));
    const filename = `${index}.tgz`;
    execFileSync('tar', ['-czf', path.join(root, filename), '-C', stage, 'package']);
    const bytes = readFileSync(path.join(root, filename));
    const files = ['package.json', `${dist}/build-identity.json`, `${dist}/${runtimeEntry}`].map(p => ({ path: p, size: readFileSync(path.join(stage, 'package', p)).length }));
    return { name, version: '1.2.3', filename, sha256: digest(bytes), integrity: integrity(bytes), buildId, unpackedSize: files.reduce((sum, f) => sum + f.size, 0), entryCount: files.length, files };
  });
  const manifest: ReleaseManifest = { schemaId: 'atm.npmReleaseArtifacts.v1', ...source, version: '1.2.3', artifacts };
  const file = path.join(root, 'manifest.json');
  writeFileSync(file, JSON.stringify(manifest));
  test('sealed package pair verifies', () => assert.deepEqual(readReleaseManifest(file), manifest));
  test('tarball byte tampering fails', () => assert.throws(() => verifyArtifact(manifest, { ...artifacts[0], sha256: '0'.repeat(64) }, root), /hash mismatch/));
  test('wrong package fails', () => assert.throws(() => verifyArtifact(manifest, { ...artifacts[0], name: 'create-atm' }, root), /Package identity/));
  test('wrong version fails', () => assert.throws(() => verifyArtifact({ ...manifest, version: '9.9.9' }, artifacts[0], root), /Package identity/));
  test('forged inventory cannot hide packed bytes', () => assert.throws(() => verifyArtifact(manifest, { ...artifacts[0], files: [] }, root), /inventory/));
  test('wrong source fails', () => assert.throws(() => verifyArtifact({ ...manifest, sourceCommit: 'c'.repeat(40) }, artifacts[0], root), /Build\/source identity/));
  test('post-build pre-seal runtime tampering fails', () => {
    const stage = path.join(root, 'stage-0');
    writeFileSync(path.join(stage, 'package/dist/npm-runtime/runtime.mjs'), 'corrupted runtime');
    execFileSync('tar', ['-czf', path.join(root, 'tampered.tgz'), '-C', stage, 'package']);
    const bytes = readFileSync(path.join(root, 'tampered.tgz'));
    assert.throws(() => verifyArtifact(manifest, { ...artifacts[0], filename: 'tampered.tgz', sha256: digest(bytes), integrity: integrity(bytes) }, root), /runtime member mismatch/);
  });
  test('unexpected packed root file fails', () => {
    const stage = path.join(root, 'stage-1');
    writeFileSync(path.join(stage, 'package/secret.txt'), 'forbidden');
    execFileSync('tar', ['-czf', path.join(root, 'extra.tgz'), '-C', stage, 'package']);
    const bytes = readFileSync(path.join(root, 'extra.tgz'));
    assert.throws(() => verifyArtifact(manifest, { ...artifacts[1], filename: 'extra.tgz', sha256: digest(bytes), integrity: integrity(bytes) }, root), /Forbidden package member/);
  });
  test('wrong build fails', () => assert.throws(() => verifyArtifact(manifest, { ...artifacts[0], buildId: '0'.repeat(64) }, root), /Build\/source identity/));
  test('path traversal fails', () => assert.throws(() => verifyArtifact(manifest, { ...artifacts[0], filename: '../0.tgz' }, root), /Unsafe/));
  test('extra package closure fails', () => { writeFileSync(file, JSON.stringify({ ...manifest, artifacts: [...artifacts, artifacts[0]] })); assert.throws(() => readReleaseManifest(file), /closure/); });

  function harness(options: { failedLifecycle?: boolean; stale?: boolean; partial?: boolean; uncertain?: boolean; rollbackFail?: boolean; wrongArtifact?: boolean } = {}) {
    const tags = Object.fromEntries(artifacts.map(a => [a.name, { latest: '1.2.2' } as Record<string, string>]));
    const events: string[] = [];
    const receipts: CandidateReceipt[] = [];
    let failedOnce = false;
    const io: CandidateIO = {
      preflight: () => { events.push('preflight'); },
      tags: name => ({ ...tags[name] }),
      publish: (a, tag) => { events.push(`publish:${a.name}`); tags[a.name][tag] = a.version; },
      verify: a => { events.push(`verify:${a.name}`); if (options.wrongArtifact) throw new Error('hash mismatch'); },
      lifecycle: () => { events.push('lifecycle'); if (options.stale) tags[artifacts[0].name].latest = '2.0.0'; if (options.failedLifecycle) throw new Error('lifecycle failed'); },
      setTag: (name, version, tag) => {
        events.push(`tag:${name}:${version}`);
        if (options.rollbackFail && version === '1.2.2') throw new Error('rollback failed');
        if ((options.partial || options.uncertain) && name === 'create-atm' && version === '1.2.3' && !failedOnce) {
          failedOnce = true;
          if (options.uncertain) tags[name][tag] = version;
          throw new Error('second promotion failed');
        }
        tags[name][tag] = version;
      },
      removeTag: (name, tag) => { delete tags[name][tag]; },
      record: receipt => receipts.push(JSON.parse(JSON.stringify(receipt)))
    };
    return { tags, events, receipts, io };
  }
  test('promotion happens only after verification and complete lifecycle', () => { const h = harness(); const r = runCandidateRelease(manifest, 'd'.repeat(64), 'latest', h.io); assert.equal(r.status, 'promoted'); assert.ok(h.events.indexOf('lifecycle') < h.events.findIndex(x => x.startsWith('tag:'))); assert.ok(Object.values(h.tags).every(t => t.latest === manifest.version)); });
  test('failed lifecycle prevents every promotion', () => { const h = harness({ failedLifecycle: true }); assert.throws(() => runCandidateRelease(manifest, 'd'.repeat(64), 'latest', h.io)); assert.ok(h.events.every(x => !x.startsWith('tag:'))); });
  test('wrong public bytes prevent promotion', () => { const h = harness({ wrongArtifact: true }); assert.throws(() => runCandidateRelease(manifest, 'd'.repeat(64), 'latest', h.io)); assert.ok(h.events.every(x => !x.startsWith('tag:'))); });
  test('stale target does not overwrite concurrent release', () => { const h = harness({ stale: true }); assert.throws(() => runCandidateRelease(manifest, 'd'.repeat(64), 'latest', h.io), /Stale/); assert.equal(h.tags[artifacts[0].name].latest, '2.0.0'); assert.ok(h.events.every(x => !x.startsWith('tag:'))); });
  test('partial promotion restores previous tags', () => { const h = harness({ partial: true }); assert.throws(() => runCandidateRelease(manifest, 'd'.repeat(64), 'latest', h.io)); assert.ok(Object.values(h.tags).every(t => t.latest === '1.2.2')); assert.equal(h.receipts.at(-1)?.status, 'blocked'); });
  test('uncertain write is reconciled, never treated as success', () => { const h = harness({ uncertain: true }); assert.throws(() => runCandidateRelease(manifest, 'd'.repeat(64), 'latest', h.io)); assert.ok(Object.values(h.tags).every(t => t.latest === '1.2.2')); });
  test('rollback failure leaves durable manual reconciliation', () => { const h = harness({ partial: true, rollbackFail: true }); assert.throws(() => runCandidateRelease(manifest, 'd'.repeat(64), 'latest', h.io)); assert.match(h.receipts.at(-1)!.recovery.join(' '), /Manual reconciliation/); });
  test('nonlatest channel leaves latest unchanged', () => { const h = harness(); runCandidateRelease(manifest, 'd'.repeat(64), 'beta', h.io); assert.ok(Object.values(h.tags).every(t => t.latest === '1.2.2' && t.beta === '1.2.3')); });
  test('older release replay cannot downgrade target tags', () => { const h = harness(); for (const tags of Object.values(h.tags)) tags.latest = '1.2.4'; assert.throws(() => runCandidateRelease(manifest, 'd'.repeat(64), 'latest', h.io), /Older candidate/); assert.ok(h.events.every(x => !x.startsWith('publish:') && !x.startsWith('tag:') && x !== 'preflight')); });
  test('next prerelease channel is supported without changing latest', () => { const h = harness(); runCandidateRelease({ ...manifest, version: '1.2.3-beta.1', artifacts: artifacts.map(a => ({ ...a, version: '1.2.3-beta.1' })) }, 'd'.repeat(64), 'next', h.io); assert.ok(Object.values(h.tags).every(t => t.latest === '1.2.2')); });
  test('interrupted mixed promotion preserves state and refuses a fresh baseline', () => { const h = harness(); h.tags[artifacts[0].name].latest = manifest.version; assert.throws(() => runCandidateRelease(manifest, 'd'.repeat(64), 'latest', h.io), /partial promotion/); assert.equal(h.tags[artifacts[0].name].latest, manifest.version); assert.ok(h.events.every(x => !x.startsWith('tag:'))); assert.match(h.receipts.at(-1)!.recovery.join(' '), /prior attempt journals/); });
  test('missing promotion permission blocks before publication', () => { const h = harness(); h.io.preflight = () => { throw new Error('permission missing'); }; assert.throws(() => runCandidateRelease(manifest, 'd'.repeat(64), 'latest', h.io), /permission/); assert.ok(h.events.every(x => !x.startsWith('publish:'))); });
  test('saved receipts cannot authorize skipping a failed fresh lifecycle', () => { const h = harness(); runCandidateRelease(manifest, 'd'.repeat(64), 'latest', h.io); h.io.lifecycle = () => { throw new Error('fresh lifecycle failed'); }; assert.throws(() => runCandidateRelease(manifest, 'd'.repeat(64), 'latest', h.io), /fresh lifecycle/); });
  console.log(`release artifact parity: ${cases} cases passed`);
} finally { rmSync(root, { recursive: true, force: true }); }
