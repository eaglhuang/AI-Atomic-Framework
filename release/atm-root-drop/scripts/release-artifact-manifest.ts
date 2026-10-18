import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PUBLIC_REGISTRY = 'https://registry.npmjs.org';
export const RELEASE_PACKAGES = ['@ai-atomic-framework/cli', 'create-atm'] as const;
export const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export const integrity = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
export type SourceIdentity = { sourceCommit: string; sourceDigest: string };
export type BuildIdentity = SourceIdentity & { schemaId: 'atm.runtimeBuildIdentity.v1'; packageName: string; version: string; buildId: string; files: { path: string; sha256: string }[] };
export type ReleaseArtifact = { name: string; version: string; filename: string; sha256: string; integrity: string; buildId: string; unpackedSize: number; entryCount: number; files: { path: string; size?: number }[] };
export type ReleaseManifest = SourceIdentity & { schemaId: 'atm.npmReleaseArtifacts.v1'; version: string; artifacts: ReleaseArtifact[] };

export function treeFiles(root: string, excluded: readonly string[] = []): string[] {
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    if (excluded.includes(entry.name)) return [];
    if (entry.isSymbolicLink()) throw new Error(`Build input must not be a symlink: ${entry.name}`);
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? treeFiles(full, excluded) : [full];
  });
}

/** Public build inputs only. No environment values, actor records or .atm data. */
export function sourceIdentity(root: string): SourceIdentity {
  let sourceCommit = 'unavailable';
  try { sourceCommit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Unattributed fixture/archive builds cannot be released. */ }
  const roots = ['packages', 'scripts', 'templates', 'schemas', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
  const files = roots.flatMap(relative => {
    const full = path.join(root, relative);
    return existsSync(full) ? lstatSync(full).isDirectory() ? treeFiles(full, ['dist', 'node_modules', '__tests__']) : [full] : [];
  }).filter(file => !/(?:^|\/)(?:dist|node_modules|__tests__)(?:\/|$)|\.test\.ts$/.test(path.relative(root, file).replaceAll('\\', '/')));
  const sourceDigest = digest(JSON.stringify(files.map(file => ({ path: path.relative(root, file).replaceAll('\\', '/'), sha256: digest(readFileSync(file)) })).sort((a, b) => a.path.localeCompare(b.path))));
  return { sourceCommit, sourceDigest };
}

export function writeBuildIdentity(root: string, output: string, packageName: string, version: string, files: string[]): BuildIdentity {
  const content = { schemaId: 'atm.runtimeBuildIdentity.v1' as const, ...sourceIdentity(root), packageName, version,
    files: files.map(file => ({ path: path.relative(output, file).replaceAll('\\', '/'), sha256: digest(readFileSync(file)) })).sort((a, b) => a.path.localeCompare(b.path)) };
  const result = { ...content, buildId: digest(JSON.stringify(content)) };
  writeFileSync(path.join(output, 'build-identity.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function memberBytes(tarball: string, relative: string): Buffer {
  return execFileSync('tar', ['-xOf', tarball, `package/${relative}`], { maxBuffer: 32 * 1024 * 1024 });
}
function member(tarball: string, relative: string): any { return JSON.parse(memberBytes(tarball, relative).toString('utf8')); }
export function assertBuildIdentity(identity: BuildIdentity, expected: SourceIdentity & { name: string; version: string; buildId?: string }): void {
  const { buildId, ...content } = identity;
  if (identity.schemaId !== 'atm.runtimeBuildIdentity.v1' || identity.packageName !== expected.name || identity.version !== expected.version
    || identity.sourceCommit !== expected.sourceCommit || identity.sourceDigest !== expected.sourceDigest
    || !/^[a-f0-9]{64}$/.test(buildId) || digest(JSON.stringify(content)) !== buildId || (expected.buildId && expected.buildId !== buildId)) {
    throw new Error(`Build/source identity mismatch: ${expected.name}`);
  }
}
export function verifyArtifact(manifest: ReleaseManifest, artifact: ReleaseArtifact, directory: string): string {
  if (path.basename(artifact.filename) !== artifact.filename || !artifact.filename.endsWith('.tgz')) throw new Error('Unsafe artifact filename');
  const tarball = path.join(directory, artifact.filename);
  if (lstatSync(tarball).isSymbolicLink()) throw new Error('Artifact must not be a symlink');
  const bytes = readFileSync(tarball);
  if (digest(bytes) !== artifact.sha256 || integrity(bytes) !== artifact.integrity) throw new Error(`Artifact hash mismatch: ${artifact.name}`);
  const pkg = member(tarball, 'package.json');
  if (pkg.name !== artifact.name || pkg.version !== manifest.version || artifact.version !== manifest.version) throw new Error(`Package identity mismatch: ${artifact.name}`);
  const isStarter = artifact.name === 'create-atm';
  const expectedBin = isStarter ? 'dist/index.js' : 'dist/npm-runtime/atm.mjs';
  const expectedImport = isStarter ? './dist/index.js' : './dist/npm-runtime/index.js';
  if (pkg.bin?.[isStarter ? 'create-atm' : 'atm'] !== expectedBin || Object.keys(pkg.bin ?? {}).length !== 1 || pkg.exports?.['.']?.import !== expectedImport) throw new Error('Package executable/export target mismatch');
  if (artifact.name === 'create-atm' && pkg.dependencies?.['@ai-atomic-framework/cli'] !== manifest.version) throw new Error('Starter must pin the exact CLI candidate');
  const prefix = artifact.name === 'create-atm' ? 'dist/' : 'dist/npm-runtime/';
  const identity = member(tarball, `${prefix}build-identity.json`) as BuildIdentity;
  assertBuildIdentity(identity, { ...manifest, ...artifact });
  if (!Array.isArray(identity.files) || identity.files.length === 0) throw new Error('Empty build member list');
  const expected = new Set<string>();
  const actualSizes = new Map<string, number>();
  for (const file of identity.files) {
    if (typeof file.path !== 'string' || path.isAbsolute(file.path) || file.path.includes('\\') || file.path.split('/').some(p => p === '..' || p === '.' || p === '')
      || expected.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Unsafe or duplicate build member');
    expected.add(file.path);
    const memberContent = memberBytes(tarball, `${prefix}${file.path}`);
    actualSizes.set(`${prefix}${file.path}`, memberContent.length);
    if (digest(memberContent) !== file.sha256) throw new Error(`Packed runtime member mismatch: ${file.path}`);
  }
  const runtimeEntry = artifact.name === 'create-atm' ? 'index.js' : 'runtime.mjs';
  if (!expected.has(runtimeEntry)) throw new Error('Missing executable build member');
  const archiveTypes = execFileSync('tar', ['-tvzf', tarball], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split('\n');
  if (archiveTypes.some(line => !line.startsWith('-') && !line.startsWith('d'))) throw new Error('Archive links and special members are forbidden');
  const archive = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split('\n');
  const seen = new Set<string>();
  for (const entry of archive) {
    if (!entry.startsWith('package/') || entry.includes('\\') || entry.split('/').includes('..') || seen.has(entry)) throw new Error('Unsafe or duplicate archive member');
    seen.add(entry);
    if (entry.endsWith('/')) continue;
    const relative = entry.slice('package/'.length);
    if (!actualSizes.has(relative)) actualSizes.set(relative, memberBytes(tarball, relative).length);
    if (!relative.startsWith(prefix)) {
      if (!['package.json', 'README.md', 'LICENSE', 'LICENSE.md', 'NOTICE'].includes(relative)) throw new Error(`Forbidden package member: ${relative}`);
      continue;
    }
    const buildRelative = relative.slice(prefix.length);
    if (!expected.has(buildRelative) && buildRelative !== 'build-identity.json' && !(artifact.name !== 'create-atm' && buildRelative === 'manifest.json')) throw new Error(`Unsealed runtime member: ${buildRelative}`);
  }
  if (!Array.isArray(artifact.files) || artifact.files.length !== actualSizes.size || artifact.entryCount !== actualSizes.size
    || artifact.unpackedSize !== [...actualSizes.values()].reduce((sum, bytes) => sum + bytes, 0)
    || new Set(artifact.files.map(file => file.path)).size !== actualSizes.size
    || artifact.files.some(file => actualSizes.get(file.path) !== file.size)) throw new Error('Artifact inventory differs from archive bytes');
  return tarball;
}
export function readReleaseManifest(file: string): ReleaseManifest {
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as ReleaseManifest;
  if (manifest.schemaId !== 'atm.npmReleaseArtifacts.v1' || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !/^[a-f0-9]{64}$/.test(manifest.sourceDigest)
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)
    || !Array.isArray(manifest.artifacts) || JSON.stringify(manifest.artifacts.map(a => a.name)) !== JSON.stringify(RELEASE_PACKAGES)
    || new Set(manifest.artifacts.map(a => a.filename)).size !== RELEASE_PACKAGES.length) throw new Error('Invalid release artifact closure');
  for (const artifact of manifest.artifacts) verifyArtifact(manifest, artifact, path.dirname(file));
  return manifest;
}
