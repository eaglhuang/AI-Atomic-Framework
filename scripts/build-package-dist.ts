import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const onlyPackage = process.argv.includes('--package')
  ? process.argv[process.argv.indexOf('--package') + 1]
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
  if (!existsSync(typeRoot)) {
    const fallback = path.join(distRoot, 'index.d.ts');
    ensureDir(fallback);
    writeFileSync(fallback, "export * from '../src/index.ts';\n", 'utf8');
    return;
  }
  for (const filePath of listFiles(typeRoot)) {
    if (!filePath.endsWith('.d.ts')) continue;
    const target = path.join(distRoot, path.relative(typeRoot, filePath));
    ensureDir(target);
    copyFileSync(filePath, target);
  }
}

function writeCliEntrypointWrapper(distRoot: string): void {
  const wrapperPath = path.join(distRoot, 'atm.mjs');
  writeFileSync(wrapperPath, `${[
    '#!/usr/bin/env node',
    "import { runCli } from './atm.js';",
    '',
    'process.exitCode = await runCli(process.argv.slice(2));'
  ].join('\n')}\n`, 'utf8');
}

function buildPackage(packageDir: string): void {
  const srcRoot = path.join(root, packageDir, 'src');
  const distRoot = path.join(root, packageDir, 'dist');
  rmSync(distRoot, { recursive: true, force: true });
  mkdirSync(distRoot, { recursive: true });
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
      ensureDir(outputPath);
      writeFileSync(outputPath, transpiled.outputText, 'utf8');
      continue;
    }
    if (filePath.endsWith('.json')) {
      ensureDir(targetBase);
      copyFileSync(filePath, targetBase);
    }
  }
  if (packageDir === 'packages/cli' && existsSync(path.join(distRoot, 'atm.js'))) {
    writeCliEntrypointWrapper(distRoot);
  }
  copyDeclarations(packageDir);
}

const packageDirs = readdirSync(path.join(root, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `packages/${entry.name}`)
  .filter((packageDir) => existsSync(path.join(root, packageDir, 'package.json')))
  .filter((packageDir) => !onlyPackage || packageDir === onlyPackage || packageDir.endsWith(`/${onlyPackage}`));

for (const packageDir of packageDirs) buildPackage(packageDir);
console.log(`[build-package-dist] built ${packageDirs.length} packages`);
