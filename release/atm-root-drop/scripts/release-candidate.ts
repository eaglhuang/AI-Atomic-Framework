import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { digest, PUBLIC_REGISTRY, readReleaseManifest, verifyArtifact, type ReleaseManifest, type ReleaseArtifact } from './release-artifact-manifest.ts';

const semver = createRequire(import.meta.url)('semver') as { valid(version: string): string | null; lt(left: string, right: string): boolean };
type Tags = Record<string, string>;
export interface CandidateIO {
  tags(name: string): Tags;
  preflight(candidateTag: string): void;
  publish(artifact: ReleaseArtifact, candidateTag: string): void;
  verify(artifact: ReleaseArtifact, candidateTag: string): void;
  lifecycle(candidateTag: string): void;
  setTag(name: string, version: string, tag: string): void;
  removeTag(name: string, tag: string): void;
  record(receipt: CandidateReceipt): void;
}
export type CandidateReceipt = { schemaId: 'atm.candidatePromotion.v1'; manifestSha256: string; sourceCommit: string; version: string; candidateTag: string; targetTag: string; status: string; previous: Record<string, string | null>; promoted: string[]; recovery: string[]; error?: string };

/** Promotion authority never comes from a saved success receipt. Every call
 * re-verifies registry bytes and runs the lifecycle; partial receipts are audit
 * and recovery information only. Dist-tag APIs have no atomic compare-and-set. */
export function runCandidateRelease(manifest: ReleaseManifest, manifestSha256: string, targetTag: string, io: CandidateIO): CandidateReceipt {
  if (!['latest', 'next', 'beta', 'lts'].includes(targetTag)) throw new Error('Unsupported target dist-tag');
  const candidateTag = `candidate-${manifest.sourceCommit.slice(0, 12)}-${manifestSha256.slice(0, 12)}`;
  const previous = Object.fromEntries(manifest.artifacts.map(a => [a.name, io.tags(a.name)[targetTag] ?? null]));
  const receipt: CandidateReceipt = { schemaId: 'atm.candidatePromotion.v1', manifestSha256, sourceCommit: manifest.sourceCommit, version: manifest.version, candidateTag, targetTag, status: 'candidate', previous, promoted: [], recovery: [] };
  const attempted = new Set<string>();
  io.record(receipt);
  try {
    if (!semver.valid(manifest.version)) throw new Error('Invalid candidate semver');
    for (const artifact of manifest.artifacts) {
      const previousVersion = previous[artifact.name];
      if (previousVersion && (!semver.valid(previousVersion) || semver.lt(manifest.version, previousVersion))) throw new Error(`Older candidate cannot replace ${artifact.name}:${targetTag}=${previousVersion}; rollback requires a separate authorized operation`);
    }
    const alreadyPromoted = manifest.artifacts.filter(a => previous[a.name] === manifest.version);
    if (alreadyPromoted.length > 0 && alreadyPromoted.length !== manifest.artifacts.length) {
      receipt.recovery.push('Mixed candidate target state requires manual reconciliation using preserved prior attempt journals before retry');
      throw new Error('Pre-existing partial promotion; refusing to overwrite recovery baseline');
    }
    io.preflight(candidateTag);
    for (const artifact of manifest.artifacts) {
      const existingCandidate = io.tags(artifact.name)[candidateTag];
      if (existingCandidate && existingCandidate !== artifact.version) throw new Error(`Candidate tag was reused: ${artifact.name}`);
      io.publish(artifact, candidateTag);
      io.verify(artifact, candidateTag);
    }
    io.lifecycle(candidateTag);
    // Re-read all tags and artifacts after the long install/task lifecycle.
    for (const artifact of manifest.artifacts) {
      io.verify(artifact, candidateTag);
      if ((io.tags(artifact.name)[targetTag] ?? null) !== previous[artifact.name]) throw new Error(`Stale target dist-tag: ${artifact.name}`);
    }
    receipt.status = 'promoting';
    io.record(receipt);
    for (const artifact of manifest.artifacts) {
      if ((io.tags(artifact.name)[targetTag] ?? null) !== previous[artifact.name]) throw new Error(`Concurrent target dist-tag change: ${artifact.name}`);
      attempted.add(artifact.name);
      io.setTag(artifact.name, artifact.version, targetTag);
      if (io.tags(artifact.name)[targetTag] !== artifact.version) throw new Error(`Promotion did not persist: ${artifact.name}`);
      receipt.promoted.push(artifact.name);
      io.record(receipt);
    }
    // A later writer may race the non-transactional two-package transition.
    for (const artifact of manifest.artifacts) if (io.tags(artifact.name)[targetTag] !== artifact.version) throw new Error(`Final target tag drift: ${artifact.name}`);
    receipt.status = 'promoted';
    io.record(receipt);
    return receipt;
  } catch (error) {
    receipt.status = 'blocked';
    receipt.error = String(error);
    // Account for an uncertain write even if setTag threw before recording it.
    for (const artifact of manifest.artifacts) {
      if (!attempted.has(artifact.name)) continue;
      try {
        const current = io.tags(artifact.name)[targetTag] ?? null;
        if (current !== manifest.version || previous[artifact.name] === manifest.version) continue;
        if (receipt.status === 'blocked' && (receipt.promoted.length > 0 || current !== previous[artifact.name])) {
          const old = previous[artifact.name];
          if (old === null) io.removeTag(artifact.name, targetTag);
          else io.setTag(artifact.name, old, targetTag);
          if ((io.tags(artifact.name)[targetTag] ?? null) !== old) throw new Error('rollback did not persist');
          receipt.recovery.push(`Restored ${artifact.name}:${targetTag} to ${old ?? '(absent)'}`);
        }
      } catch (rollbackError) {
        receipt.recovery.push(`Manual reconciliation required for ${artifact.name}:${targetTag}: ${String(rollbackError)}`);
      }
    }
    io.record(receipt);
    throw error;
  }
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const value = (flag: string) => { const i = process.argv.indexOf(flag); if (i < 0 || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new Error(`${flag} is required`); return process.argv[i + 1]; };
  const manifestPath = path.resolve(value('--manifest'));
  const manifest = readReleaseManifest(manifestPath);
  const manifestSha256 = digest(readFileSync(manifestPath));
  const directory = path.dirname(manifestPath);
  const proofDirectory = path.join(directory, 'proof');
  mkdirSync(proofDirectory, { recursive: true });
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  let registryDeadline: number | null = null;
  const runNpm = (args: string[], cwd = root) => {
    if (registryDeadline !== null && Date.now() >= registryDeadline) throw new Error('Registry visibility deadline exceeded');
    const cache = mkdtempSync(path.join(os.tmpdir(), 'atm-registry-cache-'));
    try { return execFileSync(npm, [...args, '--registry', PUBLIC_REGISTRY, '--cache', cache, '--prefer-online'], { cwd, encoding: 'utf8', shell: process.platform === 'win32', timeout: registryDeadline === null ? 60_000 : Math.max(1, Math.min(30_000, registryDeadline - Date.now())), maxBuffer: 32 * 1024 * 1024 }); }
    finally { rmSync(cache, { recursive: true, force: true }); }
  };
  const run = (program: string, args: string[]) => {
    const cache = mkdtempSync(path.join(os.tmpdir(), 'atm-consumer-cache-'));
    try { return execFileSync(program, args, { cwd: root, stdio: 'inherit', env: { ...process.env, npm_config_registry: PUBLIC_REGISTRY, npm_config_cache: cache, npm_config_prefer_online: 'true' } }); }
    finally { rmSync(cache, { recursive: true, force: true }); }
  };
  const verifyLocal = () => { if (digest(readFileSync(manifestPath)) !== manifestSha256) throw new Error('Release manifest changed during execution'); readReleaseManifest(manifestPath); };
  verifyLocal();
  run(process.execPath, ['--strip-types', 'scripts/validate-npm-clean-install.ts', '--artifact-manifest', manifestPath]);
  if (process.argv.includes('--dry-run')) {
    for (const artifact of manifest.artifacts) {
      verifyLocal();
      runNpm(['publish', path.join(directory, artifact.filename), '--ignore-scripts', '--access', 'public', '--provenance', '--tag', `candidate-${manifest.sourceCommit.slice(0, 12)}-${manifestSha256.slice(0, 12)}`, '--dry-run']);
    }
    console.log(JSON.stringify({ status: 'dry-run-only', manifestSha256, publicRegistryVerified: false, promoted: false }));
    return;
  }
  const downloaded = path.join(proofDirectory, 'downloaded');
  mkdirSync(downloaded, { recursive: true });
  const verify = (artifact: ReleaseArtifact, candidateTag: string) => {
    verifyLocal();
    const metadata = JSON.parse(runNpm(['view', `${artifact.name}@${artifact.version}`, '--json']));
    if (metadata.name !== artifact.name || metadata.version !== artifact.version || metadata.dist?.integrity !== artifact.integrity) throw new Error(`Registry metadata mismatch: ${artifact.name}`);
    const [packed] = JSON.parse(runNpm(['pack', `${artifact.name}@${artifact.version}`, '--ignore-scripts', '--pack-destination', downloaded, '--json']));
    if (packed.filename !== artifact.filename) throw new Error(`Registry filename mismatch: ${artifact.name}`);
    verifyArtifact(manifest, artifact, downloaded);
    const tags = JSON.parse(runNpm(['view', artifact.name, 'dist-tags', '--json'])) as Tags;
    if (tags[candidateTag] !== artifact.version) throw new Error(`Candidate tag mismatch: ${artifact.name}`);
  };
  // npm serves dist-tag reads through a CDN that lags writes, so a read right
  // after our own add/rm can still show the old value. Every tag write waits,
  // bounded, until it is visible; later read-after-write checks then hold.
  const readTags = (name: string) => JSON.parse(runNpm(['view', name, 'dist-tags', '--json'])) as Tags;
  const awaitTag = (name: string, tag: string, expected: string | undefined) => {
    const deadline = Date.now() + 3 * 60_000;
    while (readTags(name)[tag] !== expected && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
  };
  const attemptPath = path.join(proofDirectory, `promotion-attempt-${randomUUID()}.jsonl`);
  const io: CandidateIO = {
    preflight: candidateTag => {
      const npmVersion = runNpm(['--version']).trim();
      const [major, minor] = npmVersion.split('.').map(Number);
      if (!(major === 11 && minor >= 21 || major === 12 && minor >= 2 || major > 12)) throw new Error('OIDC dist-tag management requires npm >=11.21.0 or >=12.2.0');
      if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new Error('Release publication requires GitHub Actions Trusted Publishing OIDC');
      // Exercise actual add/remove permission on an isolated transient tag, not
      // latest. Public tag reads and npm whoami do not prove OIDC write access.
      const probeJournal = path.join(proofDirectory, `preflight-attempt-${randomUUID()}.jsonl`);
      const probeRecord = (event: Record<string, unknown>) => writeFileSync(probeJournal, `${JSON.stringify(event)}\n`, { flag: 'a' });
      const probeTag = `preflight-${candidateTag}-${randomUUID().slice(0, 8)}`;
      // Releases are serialized by the workflow concurrency group, so any
      // probe tag already present was left behind by an earlier failed run.
      for (const artifact of manifest.artifacts) {
        for (const stale of Object.keys(io.tags(artifact.name)).filter(tag => tag.startsWith('preflight-candidate-'))) {
          io.removeTag(artifact.name, stale);
          probeRecord({ status: 'removed-stale', package: artifact.name, tag: stale });
        }
      }
      for (const artifact of manifest.artifacts) {
        const tags = io.tags(artifact.name);
        const version = tags.latest ?? Object.values(tags)[0];
        if (!version) throw new Error('Initial package publication requires separate maintainer bootstrap');
        probeRecord({ status: 'planned', package: artifact.name, tag: probeTag, version });
        try {
          io.setTag(artifact.name, version, probeTag);
          if (io.tags(artifact.name)[probeTag] !== version) throw new Error('OIDC tag preflight did not persist');
        } finally {
          const current = io.tags(artifact.name)[probeTag];
          if (current === version) io.removeTag(artifact.name, probeTag);
          else if (current) throw new Error(`Preflight tag changed concurrently: ${artifact.name}:${probeTag}`);
          if (io.tags(artifact.name)[probeTag]) throw new Error(`Retained preflight tag requires cleanup: ${artifact.name}:${probeTag}`);
          probeRecord({ status: 'removed', package: artifact.name, tag: probeTag, version });
        }
      }
    },
    tags: readTags,
    publish: (artifact, candidateTag) => {
      verifyLocal();
      const existing = spawnSync(npm, ['view', `${artifact.name}@${artifact.version}`, '--json', '--registry', PUBLIC_REGISTRY, '--prefer-online'], { encoding: 'utf8', shell: process.platform === 'win32' });
      if (existing.status === 0) {
        // An existing immutable version is reusable only after byte verification.
        const metadata = JSON.parse(existing.stdout);
        if (metadata.name !== artifact.name || metadata.version !== artifact.version || metadata.dist?.integrity !== artifact.integrity) throw new Error(`Existing version differs: ${artifact.name}`);
        const [packed] = JSON.parse(runNpm(['pack', `${artifact.name}@${artifact.version}`, '--ignore-scripts', '--pack-destination', downloaded, '--json']));
        if (packed.filename !== artifact.filename) throw new Error('Existing artifact filename differs');
        verifyArtifact(manifest, artifact, downloaded);
        runNpm(['dist-tag', 'add', `${artifact.name}@${artifact.version}`, candidateTag]);
        return;
      }
      if (!/E404/.test(existing.stderr + existing.stdout)) throw new Error(`Registry lookup failed for ${artifact.name}; refusing uncertain publish`);
      runNpm(['publish', path.join(directory, artifact.filename), '--ignore-scripts', '--access', 'public', '--provenance', '--tag', candidateTag]);
      // Registry visibility is an execution-plane wait with a bounded timeout.
      registryDeadline = Date.now() + 10 * 60_000;
      try { for (let attempt = 0; attempt < 40; attempt += 1) {
        try { verify(artifact, candidateTag); return; } catch (error) {
          if (attempt === 39 || Date.now() >= registryDeadline) throw error;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(15_000, registryDeadline - Date.now()));
        }
      } } finally { registryDeadline = null; }
    },
    verify,
    lifecycle: candidateTag => {
      writeFileSync(path.join(downloaded, 'manifest.json'), readFileSync(manifestPath));
      run(process.execPath, ['--strip-types', 'scripts/validate-npm-clean-install.ts', '--artifact-manifest', path.join(downloaded, 'manifest.json')]);
      run(process.execPath, ['--strip-types', 'scripts/validate-public-npm-install.ts', '--version', manifest.version, '--artifact-manifest', manifestPath, '--expected-tag', candidateTag, '--output', path.join(proofDirectory, 'public-npm-install.md')]);
      run('bash', ['scripts/validate-public-starter.sh', manifest.version, value('--target-tag'), manifestPath]);
      verifyLocal();
    },
    setTag: (name, version, tag) => { runNpm(['dist-tag', 'add', `${name}@${version}`, tag]); awaitTag(name, tag, version); },
    removeTag: (name, tag) => { runNpm(['dist-tag', 'rm', name, tag]); awaitTag(name, tag, undefined); },
    record: receipt => {
      // Append-only attempt journals preserve original previous tags across a
      // crash and retry; promotion.json is only a convenient latest summary.
      writeFileSync(attemptPath, `${JSON.stringify(receipt)}\n`, { flag: 'a' });
      writeFileSync(path.join(proofDirectory, 'promotion.json'), `${JSON.stringify(receipt, null, 2)}\n`);
    }
  };
  console.log(JSON.stringify(runCandidateRelease(manifest, manifestSha256, value('--target-tag'), io), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
