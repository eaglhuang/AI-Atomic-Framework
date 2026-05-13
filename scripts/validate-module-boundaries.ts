import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createValidator } from './lib/validator-harness.ts';

const validator = createValidator('module-boundaries');
const { assert, ok, root } = validator;

const scanRoots = ['packages', 'scripts', 'tests', 'examples'].map((entry) => path.join(root, entry));
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

const sourceFiles = scanRoots.flatMap((directory) => walk(directory));
const sourceMjsFiles = sourceFiles.filter((filePath) => filePath.endsWith('.mjs'));
assert(sourceMjsFiles.length === 0, `source tree must not contain .mjs modules: ${sourceMjsFiles.map((filePath) => path.relative(root, filePath)).join(', ')}`);

for (const filePath of sourceFiles.filter((candidate) => candidate.endsWith('.ts'))) {
  const content = readFileSync(filePath, 'utf8');
  const relPath = path.relative(root, filePath).replace(/\\/g, '/');
  for (const pattern of importPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const specifier = match[2];
      if (!specifier.startsWith('.')) continue;
      assert(!specifier.endsWith('.mjs'), `${relPath} imports a .mjs source module: ${specifier}`);
    }
  }
}

ok(`verified ${sourceFiles.filter((filePath) => filePath.endsWith('.ts')).length} TypeScript source files`);
