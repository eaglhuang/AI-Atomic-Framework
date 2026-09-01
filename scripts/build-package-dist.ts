import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { writeTextWithRetry } from './lib/windows-write-retry.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_PACKAGE_DIR = 'packages/cli';
const VENDOR_DIRNAME = '_vendor';
const onlyPackage = process.argv.includes('--package')
  ? process.argv[process.argv.indexOf('--package') + 1]
  : null;
const onlyPackages = process.argv.includes('--packages')
  ? new Set(String(process.argv[process.argv.indexOf('--packages') + 1] ?? '').split(',').map((entry) => entry.trim()).filter(Boolean))
  : null;

function listFiles(directory: string, results: string[] = []): string[] {
  if (!existsSync(directory)) return results;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      listFiles(fullPath, results);
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function rewriteSpecifier(specifier: string, sourceFile: string): string {
  if (!specifier.startsWith('.')) return specifier;
  const rewritten = specifier.replace(/\/src\//g, '/dist/');
  const resolved = path.resolve(path.dirname(sourceFile), specifier);
  const normalizedResolved = resolved.replace(/\\/g, '/');
  const packageSourceMatch = sourceFile.replace(/\\/g, '/').match(/^(.*\/packages\/[^/]+)\/src\//);
  const currentPackageRoot = packageSourceMatch ? packageSourceMatch[1] : null;
  const pointsIntoPackageSource = normalizedResolved.includes('/packages/') && normalizedResolved.includes('/src/');
  const pointsIntoCurrentPackageSource = currentPackageRoot
    ? normalizedResolved.startsWith(`${currentPackageRoot}/src/`)
    : false;

  if (rewritten.endsWith('.js') || rewritten.endsWith('.mjs') || rewritten.endsWith('.json')) return rewritten;
  if (rewritten.endsWith('.ts')) {
    return pointsIntoPackageSource || pointsIntoCurrentPackageSource
      ? rewritten.replace(/\.ts$/, '.js')
      : specifier;
  }
  if (existsSync(`${resolved}.ts`)) {
    return pointsIntoPackageSource || pointsIntoCurrentPackageSource
      ? `${rewritten}.js`
      : `${specifier}.ts`;
  }
  if (existsSync(path.join(resolved, 'index.ts'))) {
    return pointsIntoPackageSource || pointsIntoCurrentPackageSource
      ? `${rewritten.replace(/\/$/, '')}/index.js`
      : `${specifier.replace(/\/$/, '')}/index.ts`;
  }
  return rewritten;
}

function rewriteRelativeImports(source: string, sourceFile: string): string {
  const replacer = (_match: string, prefix: string, specifier: string, suffix: string) =>
    `${prefix}${rewriteSpecifier(specifier, sourceFile)}${suffix}`;
  return source
    .replace(/(from\s+['"])([^'"]+)(['"])/g, replacer)
    .replace(/(import\s+['"])([^'"]+)(['"])/g, replacer)
    .replace(/(import\(\s*['"])([^'"]+)(['"]\s*\))/g, replacer);
}

function ensureDir(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function copyDeclarations(packageDir: string): void {
  const typeRoot = path.join(root, '.types', packageDir, 'src');
  const distRoot = path.join(root, packageDir, 'dist');
  for (const declarationEntrypoint of declaredDeclarationEntrypoints(packageDir)) {
    const absoluteEntrypoint = path.join(root, packageDir, declarationEntrypoint);
    const declarationSource = path.join(typeRoot, declarationEntrypoint.replace(/^dist\//, ''));
    if (existsSync(declarationSource)) {
      ensureDir(absoluteEntrypoint);
      copyFileSync(declarationSource, absoluteEntrypoint);
      continue;
    }
    if (existsSync(absoluteEntrypoint)) continue;
    const sourceName = path.basename(declarationEntrypoint, '.d.ts');
    // Incremental caches may survive while a fresh sealed worktree has no hydrated .types output.
    ensureDir(absoluteEntrypoint);
    writeFileSync(absoluteEntrypoint, `export * from '../src/${sourceName}.ts';\n`, 'utf8');
  }
}

function declaredDeclarationEntrypoints(packageDir: string): readonly string[] {
  const packageJson = JSON.parse(readFileSync(path.join(root, packageDir, 'package.json'), 'utf8')) as {
    types?: string;
    exports?: Record<string, { types?: string }>;
    bin?: Record<string, string> | string;
  };
  const declared = new Set<string>();
  if (packageJson.types) declared.add(packageJson.types);
  for (const value of Object.values(packageJson.exports ?? {})) {
    if (value?.types) declared.add(value.types);
  }
  const bins = typeof packageJson.bin === 'string' ? [packageJson.bin] : Object.values(packageJson.bin ?? {});
  for (const binPath of bins) {
    declared.add(binPath.replace(/\.(?:m?js)$/, '.d.ts'));
  }
  if (declared.size === 0) declared.add('./dist/index.d.ts');
  return [...declared].map((entry) => entry.replace(/^\.\//, ''));
}

function writeCliEntrypointWrapper(distRoot: string): void {
  const wrapperPath = path.join(distRoot, 'atm.mjs');
  writeTextIfChanged(wrapperPath, `${[
    '#!/usr/bin/env node',
    "import { runCli } from './atm.js';",
    '',
    'process.exitCode = await runCli(process.argv.slice(2));'
  ].join('\n')}\n`);
}

function buildPackage(packageDir: string, mode: 'full' | 'incremental'): void {
  const srcRoot = path.join(root, packageDir, 'src');
  const distRoot = path.join(root, packageDir, 'dist');
  if (mode === 'full') {
    rmSync(distRoot, { recursive: true, force: true });
  }
  mkdirSync(distRoot, { recursive: true });
  const expectedOutputs = new Set<string>();
  for (const filePath of listFiles(srcRoot)) {
    const relativePath = path.relative(srcRoot, filePath);
    if (relativePath.split(path.sep).includes('__tests__') || /\.test\.ts$/.test(relativePath)) {
      continue;
    }
    const targetBase = path.join(distRoot, relativePath);
    if (filePath.endsWith('.ts')) {
      const source = rewriteRelativeImports(readFileSync(filePath, 'utf8'), filePath);
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          sourceMap: false,
          removeComments: false
        },
        fileName: filePath
      });
      const outputPath = targetBase.replace(/\.ts$/, '.js');
      expectedOutputs.add(path.relative(distRoot, outputPath).replace(/\\/g, '/'));
      ensureDir(outputPath);
      writeTextIfChanged(outputPath, transpiled.outputText);
      continue;
    }
    if (filePath.endsWith('.json')) {
      expectedOutputs.add(path.relative(distRoot, targetBase).replace(/\\/g, '/'));
      ensureDir(targetBase);
      copyFileIfChanged(filePath, targetBase);
    }
  }
  if (packageDir === 'packages/cli' && existsSync(path.join(distRoot, 'atm.js'))) {
    expectedOutputs.add('atm.mjs');
    writeCliEntrypointWrapper(distRoot);
  }
  copyDeclarations(packageDir);
  const declaredDeclarations = new Set(declaredDeclarationEntrypoints(packageDir));
  for (const filePath of listFiles(distRoot)) {
    const relative = path.relative(distRoot, filePath).replace(/\\/g, '/');
    if (relative.split('/').includes('__tests__') || /\.test\.d\.ts$/.test(relative)) {
      unlinkSync(filePath);
      continue;
    }
    if (relative.endsWith('.d.ts')) {
      if (!declaredDeclarations.has(relative)) unlinkSync(filePath);
      continue;
    }
    if (!expectedOutputs.has(relative)) unlinkSync(filePath);
  }
  if (packageDir === 'packages/integrations-core') {
    const templateSource = path.join(root, 'templates', 'skills');
    const templateTarget = path.join(root, packageDir, 'templates', 'skills');
    rmSync(path.dirname(templateTarget), { recursive: true, force: true });
    for (const filePath of listFiles(templateSource)) {
      const target = path.join(templateTarget, path.relative(templateSource, filePath));
      ensureDir(target);
      copyFileIfChanged(filePath, target);
    }
  }
}

const packageDirs = readdirSync(path.join(root, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `packages/${entry.name}`)
  .filter((packageDir) => existsSync(path.join(root, packageDir, 'package.json')))
  .filter((packageDir) => !onlyPackage || packageDir === onlyPackage || packageDir.endsWith(`/${onlyPackage}`))
  .filter((packageDir) => !onlyPackages || onlyPackages.has(packageDir) || onlyPackages.has(packageDir.replace(/^packages\//, '')));

const mode = onlyPackage || onlyPackages ? 'incremental' : 'full';
for (const packageDir of packageDirs) buildPackage(packageDir, mode);
if (packageDirs.includes(CLI_PACKAGE_DIR)) buildCliRuntimeClosure();
console.log(`[build-package-dist] built ${packageDirs.length} packages (${mode})`);

function writeTextIfChanged(filePath: string, content: string): void {
  if (existsSync(filePath) && readFileSync(filePath, 'utf8') === content) return;
  writeTextWithRetry(filePath, content);
}

function copyFileIfChanged(source: string, target: string): void {
  if (existsSync(target) && fileDigest(source) === fileDigest(target)) return;
  copyFileSync(source, target);
}

function fileDigest(filePath: string): string {
  const stats = statSync(filePath);
  return createHash('sha256').update(readFileSync(filePath)).update(String(stats.mode & 0o777)).digest('hex');
}

// --- CLI runtime closure -------------------------------------------------
// The CLI is the single published product. Transpiled CLI modules reference
// sibling workspaces through relative specifiers that escape packages/cli, so
// an npm tarball containing only packages/cli/dist resolves nothing. Vendor the
// referenced workspaces under dist/_vendor using the same packages/<name>/
// layout: intra-vendor relative specifiers then resolve unchanged, and only the
// CLI's own escaping specifiers need rewriting.

type EscapingReference = {
  readonly specifier: string;
  readonly packageName: string;
  readonly absoluteTarget: string;
};

function packageOwnerOf(absolutePath: string): string | null {
  const normalized = absolutePath.replace(/\\/g, '/');
  const packagesRoot = `${root.replace(/\\/g, '/')}/packages/`;
  if (!normalized.startsWith(packagesRoot)) return null;
  const packageName = normalized.slice(packagesRoot.length).split('/')[0];
  return packageName || null;
}

function escapingPackageReferences(sourceFile: string, resolveFrom: string): readonly EscapingReference[] {
  const source = readFileSync(sourceFile, 'utf8');
  const owner = packageOwnerOf(resolveFrom);
  const references: EscapingReference[] = [];
  const patterns = [
    /from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]!;
      if (!specifier.startsWith('.')) continue;
      const absoluteTarget = path.resolve(path.dirname(resolveFrom), specifier);
      const targetOwner = packageOwnerOf(absoluteTarget);
      if (!targetOwner || targetOwner === owner) continue;
      references.push({ specifier, packageName: targetOwner, absoluteTarget });
    }
  }
  return references;
}

function publishRootsOf(packageName: string): readonly string[] {
  const manifestPath = path.join(root, 'packages', packageName, 'package.json');
  if (!existsSync(manifestPath)) return ['dist'];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { files?: string[] };
  const roots = (manifest.files ?? ['dist']).filter((entry) => entry !== 'src' && !entry.endsWith('.md'));
  return roots.length > 0 ? roots : ['dist'];
}

function copyRuntimeTree(sourceRoot: string, targetRoot: string): readonly string[] {
  const copied: string[] = [];
  for (const filePath of listFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, filePath);
    if (relative.split(path.sep).includes('__tests__') || /\.test\.[cm]?[jt]s$/.test(relative)) continue;
    const target = path.join(targetRoot, relative);
    ensureDir(target);
    copyFileIfChanged(filePath, target);
    copied.push(filePath);
  }
  return copied;
}

function replaceSpecifier(source: string, specifier: string, replacement: string): string {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source
    .replace(new RegExp(`(from\\s+['"])${escaped}(['"])`, 'g'), `$1${replacement}$2`)
    .replace(new RegExp(`(import\\s+['"])${escaped}(['"])`, 'g'), `$1${replacement}$2`)
    .replace(new RegExp(`(import\\(\\s*['"])${escaped}(['"]\\s*\\))`, 'g'), `$1${replacement}$2`);
}

function buildCliRuntimeClosure(): void {
  const cliDist = path.join(root, CLI_PACKAGE_DIR, 'dist');
  const vendorRoot = path.join(cliDist, VENDOR_DIRNAME);
  rmSync(vendorRoot, { recursive: true, force: true });
  if (!existsSync(cliDist)) return;

  const cliFiles = listFiles(cliDist).filter((filePath) => /\.[cm]?js$/.test(filePath));
  const vendored = new Set<string>();
  const pending: string[] = [];
  const enqueue = (packageName: string): void => {
    if (packageName === 'cli' || vendored.has(packageName)) return;
    vendored.add(packageName);
    pending.push(packageName);
  };
  for (const filePath of cliFiles) {
    for (const reference of escapingPackageReferences(filePath, filePath)) enqueue(reference.packageName);
  }

  while (pending.length > 0) {
    const packageName = pending.shift()!;
    for (const publishRoot of publishRootsOf(packageName)) {
      const sourceRoot = path.join(root, 'packages', packageName, publishRoot);
      if (!existsSync(sourceRoot)) continue;
      for (const originalFile of copyRuntimeTree(sourceRoot, path.join(vendorRoot, packageName, publishRoot))) {
        if (!/\.[cm]?js$/.test(originalFile)) continue;
        // Resolve against the authored location so an escaping specifier names
        // the workspace it was written against, not the vendored copy.
        for (const reference of escapingPackageReferences(originalFile, originalFile)) enqueue(reference.packageName);
      }
    }
  }

  // A vendored workspace may reference back into the CLI. The mirrored layout
  // cannot satisfy that, because the CLI is the tarball root rather than a
  // vendored sibling, so those specifiers are redirected to the real CLI dist.
  let rewrittenVendorFiles = 0;
  for (const vendorFile of listFiles(vendorRoot)) {
    if (!/\.[cm]?js$/.test(vendorFile)) continue;
    const relativeToVendor = path.relative(vendorRoot, vendorFile);
    const vendoredPackage = relativeToVendor.split(path.sep)[0]!;
    const originalFile = path.join(root, 'packages', vendoredPackage, path.relative(path.join(vendorRoot, vendoredPackage), vendorFile));
    const cliReferences = escapingPackageReferences(originalFile, originalFile).filter((reference) => reference.packageName === 'cli');
    if (cliReferences.length === 0) continue;
    let source = readFileSync(vendorFile, 'utf8');
    for (const reference of cliReferences) {
      let rewritten = path.relative(path.dirname(vendorFile), reference.absoluteTarget).replace(/\\/g, '/');
      if (!rewritten.startsWith('.')) rewritten = `./${rewritten}`;
      source = replaceSpecifier(source, reference.specifier, rewritten);
    }
    writeTextIfChanged(vendorFile, source);
    rewrittenVendorFiles += 1;
  }

  let rewrittenFiles = 0;
  for (const filePath of cliFiles) {
    const references = escapingPackageReferences(filePath, filePath);
    if (references.length === 0) continue;
    let source = readFileSync(filePath, 'utf8');
    for (const reference of references) {
      const vendorTarget = path.join(
        vendorRoot,
        reference.packageName,
        path.relative(path.join(root, 'packages', reference.packageName), reference.absoluteTarget)
      );
      let rewritten = path.relative(path.dirname(filePath), vendorTarget).replace(/\\/g, '/');
      if (!rewritten.startsWith('.')) rewritten = `./${rewritten}`;
      source = replaceSpecifier(source, reference.specifier, rewritten);
    }
    writeTextIfChanged(filePath, source);
    rewrittenFiles += 1;
  }
  // Adoption templates are a data asset of the same closure. `atm init` finds
  // its bundled repo root by walking up from the loaded module until it sees
  // templates/root-drop: in the monorepo that walk reaches the repository root,
  // so inside a tarball it must terminate at dist/. Without this the command
  // resolves a path that the published package never carried.
  const adoptionTemplateSource = path.join(root, 'templates', 'root-drop');
  const adoptionTemplateTarget = path.join(cliDist, 'templates', 'root-drop');
  rmSync(adoptionTemplateTarget, { recursive: true, force: true });
  let adoptionTemplateFiles = 0;
  if (existsSync(adoptionTemplateSource)) {
    adoptionTemplateFiles = copyRuntimeTree(adoptionTemplateSource, adoptionTemplateTarget).length;
  }

  console.log(`[build-package-dist] cli runtime closure: vendored ${vendored.size} workspaces, rewrote ${rewrittenFiles} cli modules and ${rewrittenVendorFiles} vendored modules, bundled ${adoptionTemplateFiles} adoption template files`);
}
