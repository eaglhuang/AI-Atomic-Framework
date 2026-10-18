import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Runtime closure the onefile payload needs beyond the root-drop tree: atomize
// helper modules and runtime npm packages. Kept out of build-onefile-release.ts
// so that builder stays within the physical line budget.

// Atomize subcommands load these helper modules from the framework root. A
// onefile launcher runs from its extraction cache, so they must be embedded
// explicitly; otherwise `atomize inventory|backfill` cannot start in adopter
// repositories (ERR_MODULE_NOT_FOUND on scripts/src/atomize-*.js).
export const onefilePayloadAtomizeHelperFiles = new Set([
  'docs/ATOMIZATION_COVERAGE_TAXONOMY.md',
  'scripts/src/atomization-register-receipt.js',
  'scripts/src/atomize-backfill.js',
  'scripts/src/atomize-inventory.js',
  'scripts/src/atomize-score.js'
]);
export const onefilePayloadAtomizeDataPrefixes = [
  'atomic_workbench/atomization-coverage/path-to-atom-map-shards/'
];

// Runtime npm packages imported by bare specifier from the embedded CLI and
// core (for example ajv in broker proposal validation). The onefile has no
// node_modules of its own, so these packages are carried from the host
// install. Without them, broker proposal create fails in any adopter repo
// that does not happen to install ajv itself.
export const onefilePayloadRuntimeDependencies = [
  'ajv',
  'ajv-formats',
  'fast-deep-equal',
  'fast-uri',
  'json-schema-traverse',
  'require-from-string'
] as const;

export function collectRuntimeDependencyPayloadFiles(repositoryRoot: string) {
  const nodeModulesRoot = path.join(repositoryRoot, 'node_modules');
  const files: any[] = [];
  for (const packageName of onefilePayloadRuntimeDependencies) {
    const packageRoot = path.join(nodeModulesRoot, packageName);
    if (!existsSync(path.join(packageRoot, 'package.json'))) {
      // Fail closed: a onefile without these packages is a broken runner.
      throw new Error(`Onefile runtime dependency ${packageName} is missing from ${nodeModulesRoot}; run npm ci before building the onefile release.`);
    }
    for (const absolutePath of walkFiles(packageRoot)) {
      const relativePath = path.relative(repositoryRoot, absolutePath).replace(/\\/g, '/');
      if (!isOnefileRuntimeDependencyPath(relativePath)) {
        continue;
      }
      const stats = statSync(absolutePath);
      files.push({
        path: relativePath,
        mode: stats.mode & 0o777,
        dataBase64: readFileSync(absolutePath).toString('base64')
      });
    }
  }
  return files;
}

export function isOnefileAtomizeClosurePath(normalized: string): boolean {
  return onefilePayloadAtomizeHelperFiles.has(normalized)
    || onefilePayloadAtomizeDataPrefixes.some((prefix) => normalized.startsWith(prefix));
}

export function isOnefileRuntimeDependencyPath(relativePath: string) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)\/(.+)$/.exec(normalized);
  if (!match || !(onefilePayloadRuntimeDependencies as readonly string[]).includes(match[1]!)) {
    return false;
  }
  const inPackage = match[2]!;
  if (/(^|\/)(test|tests|benchmark|docs)\//.test(inPackage)) {
    return false;
  }
  return inPackage === 'package.json' || /\.(js|json)$/.test(inPackage);
}

function walkFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(absolutePath) : [absolutePath];
  });
}
