import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, integrity, readReleaseManifest, RELEASE_PACKAGES, sourceIdentity, type ReleaseManifest } from './release-artifact-manifest.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = process.argv.indexOf('--output');
const output = path.resolve(index < 0 ? 'release/npm-artifacts' : process.argv[index + 1]);
// Never overwrite an earlier tested candidate. A retry must reuse its manifest.
mkdirSync(output, { recursive: false });
const source = sourceIdentity(root);
if (!/^[a-f0-9]{40}$/.test(source.sourceCommit)) throw new Error('Release sealing requires an attributable source commit');
const artifacts = RELEASE_PACKAGES.map(name => {
  const directory = path.join(root, 'packages', name === 'create-atm' ? 'create-atm' : 'cli');
  const pkg = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const identity = JSON.parse(readFileSync(path.join(directory, name === 'create-atm' ? 'dist/build-identity.json' : 'dist/npm-runtime/build-identity.json'), 'utf8'));
  const [packed] = JSON.parse(execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--workspace', name, '--ignore-scripts', '--pack-destination', output, '--json'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 16 * 1024 * 1024 }));
  const bytes = readFileSync(path.join(output, packed.filename));
  return { name, version: pkg.version as string, filename: packed.filename as string, sha256: digest(bytes), integrity: integrity(bytes), buildId: identity.buildId as string, unpackedSize: packed.unpackedSize as number, entryCount: packed.entryCount as number, files: packed.files as { path: string }[] };
});
const manifest: ReleaseManifest = { schemaId: 'atm.npmReleaseArtifacts.v1', ...source, version: artifacts[0].version, artifacts };
const manifestFile = path.join(output, 'manifest.json');
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
readReleaseManifest(manifestFile);
for (const artifact of artifacts) chmodSync(path.join(output, artifact.filename), 0o444);
chmodSync(manifestFile, 0o444);
console.log(JSON.stringify({ ok: true, manifest: path.relative(root, manifestFile), sha256: digest(readFileSync(manifestFile)), artifacts: artifacts.map(({ files: _files, ...a }) => a) }, null, 2));
