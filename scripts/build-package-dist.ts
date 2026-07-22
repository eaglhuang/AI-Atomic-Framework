import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  if (existsSync(typeRoot)) {
    for (const filePath of listFiles(typeRoot)) {
      if (!filePath.endsWith('.d.ts')) continue;
      const target = path.join(distRoot, path.relative(typeRoot, filePath));
      ensureDir(target);
      copyFileSync(filePath, target);
    }
  }
  const declarationEntrypoint = path.join(distRoot, 'index.d.ts');
  if (!existsSync(declarationEntrypoint)) {
    // Incremental caches may survive while a fresh sealed worktree has no hydrated .types output.
    ensureDir(declarationEntrypoint);
    writeFileSync(declarationEntrypoint, "export * from '../src/index.ts';\n", 'utf8');
  }
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
  for (const filePath of listFiles(distRoot)) {
    const relative = path.relative(distRoot, filePath).replace(/\\/g, '/');
    if (relative.endsWith('.d.ts')) continue;
    if (!expectedOutputs.has(relative)) unlinkSync(filePath);
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
console.log(`[build-package-dist] built ${packageDirs.length} packages (${mode})`);

function writeTextIfChanged(filePath: string, content: string): void {
  if (existsSync(filePath) && readFileSync(filePath, 'utf8') === content) return;
  writeFileSync(filePath, content, 'utf8');
}

function copyFileIfChanged(source: string, target: string): void {
  if (existsSync(target) && fileDigest(source) === fileDigest(target)) return;
  copyFileSync(source, target);
}

function fileDigest(filePath: string): string {
  const stats = statSync(filePath);
  return createHash('sha256').update(readFileSync(filePath)).update(String(stats.mode & 0o777)).digest('hex');
}
