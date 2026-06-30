import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createValidator } from './lib/validator-harness.ts';

const validator = createValidator('module-boundaries');
const { assert, ok, root } = validator;

const scanRoots = ['packages', 'scripts', 'tests', 'examples'].map((entry) => path.join(root, entry));
const allowedSourceMjsFiles = new Set([
  'scripts/repro/bug-atm-0045-planning-root-preference.mjs',
  'scripts/templates/atm-stable-launcher.mjs'
]);
const importPatterns = [
  /(from\s+['"])([^'"]+)(['"])/g,
  /(import\s+['"])([^'"]+)(['"])/g,
  /(import\(\s*['"])([^'"]+)(['"]\s*\))/g
];

function walk(directory: string, results: string[] = []): string[] {
  if (!existsSync(directory)) return results;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules') continue;
      walk(fullPath, results);
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function resolvesIntoScripts(fileAbsPath: string, specifier: string): boolean {
  const resolved = path.resolve(path.dirname(fileAbsPath), specifier);
  const rel = path.relative(root, resolved).replace(/\\/g, '/');
  return rel.startsWith('scripts/') || rel === 'scripts';
}

const sourceFiles = scanRoots.flatMap((directory) => walk(directory));
const sourceMjsFiles = sourceFiles
  .filter((filePath) => filePath.endsWith('.mjs'))
  .map((filePath) => path.relative(root, filePath).replace(/\\/g, '/'));
const unexpectedSourceMjsFiles = sourceMjsFiles.filter((filePath) => !allowedSourceMjsFiles.has(filePath));
assert(
  unexpectedSourceMjsFiles.length === 0,
  `source tree must not contain unapproved .mjs modules: ${unexpectedSourceMjsFiles.join(', ')}`
);
for (const allowedFile of allowedSourceMjsFiles) {
  assert(sourceMjsFiles.includes(allowedFile), `approved .mjs module is missing: ${allowedFile}`);
}

for (const filePath of sourceFiles.filter((candidate) => candidate.endsWith('.ts'))) {
  const content = readFileSync(filePath, 'utf8');
  const relPath = path.relative(root, filePath).replace(/\\/g, '/');
  const isPackageRuntime = relPath.startsWith('packages/') && relPath.includes('/src/');
  for (const pattern of importPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const specifier = match[2];
      if (!specifier.startsWith('.')) continue;
      assert(!specifier.endsWith('.mjs'), `${relPath} imports a .mjs source module: ${specifier}`);
      if (isPackageRuntime) {
        assert(!resolvesIntoScripts(filePath, specifier), `package runtime must not import from scripts/: ${relPath} imports ${specifier}`);
      }
    }
  }
}

// Verify the negative fixture is detectable by the deny rule.
const negativeFixture = path.join(root, 'fixtures/module-boundaries/deny-runtime-scripts.fixture.ts');
assert(existsSync(negativeFixture), 'negative fixture for scripts deny rule must exist: fixtures/module-boundaries/deny-runtime-scripts.fixture.ts');
const fixtureContent = readFileSync(negativeFixture, 'utf8');
const fixtureHasScriptsImport = importPatterns.some((pattern) => {
  pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(fixtureContent)) !== null) {
    if (m[2].includes('scripts/')) return true;
  }
  return false;
});
assert(fixtureHasScriptsImport, 'negative fixture must contain a scripts/ import to demonstrate the deny rule');

ok(`verified ${sourceFiles.filter((filePath) => filePath.endsWith('.ts')).length} TypeScript source files`);
