import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const onlyPackage = process.argv.includes('--package')
  ? process.argv[process.argv.indexOf('--package') + 1]
  : null;

function listFiles(directory) {
  if (!existsSync(directory)) return [];
  const results = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(fullPath));
    else results.push(fullPath);
  }
  return results;
}

function rewriteSpecifier(specifier, sourceFile) {
  if (!specifier.startsWith('.')) return specifier;
  if (specifier.endsWith('.ts')) return specifier.replace(/\.ts$/, '.js');
  if (specifier.endsWith('.js') || specifier.endsWith('.mjs') || specifier.endsWith('.json')) return specifier;
  const resolved = path.resolve(path.dirname(sourceFile), specifier);
  if (existsSync(`${resolved}.ts`)) return `${specifier}.js`;
  if (existsSync(`${resolved}.mjs`)) return `${specifier}.mjs`;
  if (existsSync(path.join(resolved, 'index.ts'))) return `${specifier.replace(/\/$/, '')}/index.js`;
  return specifier;
}

function rewriteRelativeImports(source, sourceFile) {
  const replacer = (_match, prefix, specifier, suffix) => `${prefix}${rewriteSpecifier(specifier, sourceFile)}${suffix}`;
  return source
    .replace(/(from\s+['"])([^'"]+)(['"])/g, replacer)
    .replace(/(import\s+['"])([^'"]+)(['"])/g, replacer)
    .replace(/(import\(\s*['"])([^'"]+)(['"]\s*\))/g, replacer);
}

function ensureDir(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function copyDeclarations(packageDir) {
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

function buildPackage(packageDir) {
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
    if (filePath.endsWith('.mjs') || filePath.endsWith('.json')) {
      ensureDir(targetBase);
      copyFileSync(filePath, targetBase);
    }
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
