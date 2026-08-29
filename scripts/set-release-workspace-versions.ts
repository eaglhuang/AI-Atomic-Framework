import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLISHED_DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

type PackageManifest = {
  name?: unknown;
  version?: unknown;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function readManifest(manifestPath: string): PackageManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
}

function writeManifest(manifestPath: string, manifest: PackageManifest): void {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function packageManifestPaths(root: string): string[] {
  const packagesRoot = path.join(root, 'packages');
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesRoot, entry.name, 'package.json'));
}

/**
 * Release tags may be prereleases while source manifests retain their next
 * stable train version. Published runtime dependencies must nevertheless
 * resolve to the exact tag version, otherwise npm attempts to install a
 * stable version that does not exist yet.
 */
export function synchronizeReleaseWorkspaceVersions(root: string, releaseVersion: string): string[] {
  if (!releaseVersion) throw new Error('release version is required');

  const manifestPaths = packageManifestPaths(root);
  const workspaceNames = new Set(
    manifestPaths
      .map((manifestPath) => readManifest(manifestPath).name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
  );
  const changed: string[] = [];

  for (const manifestPath of manifestPaths) {
    const manifest = readManifest(manifestPath);
    let didChange = false;
    for (const field of PUBLISHED_DEPENDENCY_FIELDS) {
      const dependencies = manifest[field];
      if (!dependencies) continue;
      for (const dependencyName of Object.keys(dependencies)) {
        if (!workspaceNames.has(dependencyName) || dependencies[dependencyName] === releaseVersion) continue;
        dependencies[dependencyName] = releaseVersion;
        didChange = true;
      }
    }
    if (didChange) {
      writeManifest(manifestPath, manifest);
      changed.push(path.relative(root, manifestPath).replaceAll('\\', '/'));
    }
  }
  return changed;
}

function readFlag(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function main(): void {
  const root = path.resolve(readFlag('--root') ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const version = readFlag('--version');
  if (!version) throw new Error('usage: set-release-workspace-versions --version <semver> [--root <path>]');
  const changed = synchronizeReleaseWorkspaceVersions(root, version);
  console.log(`[release-workspace-versions] synchronized ${changed.length} manifest(s) to ${version}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
