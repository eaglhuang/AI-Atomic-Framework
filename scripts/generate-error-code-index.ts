#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface ErrorCodeOccurrence {
  readonly code: string;
  readonly filePath: string;
  readonly lineNumber: number;
  readonly context: string;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = ['packages', 'scripts', 'tests', 'examples'].map((entry) => path.join(root, entry));
const outputPath = path.join(root, 'docs', 'ERROR_CODES.md');
const codePattern = /\bATM_[A-Z0-9_]+\b/g;
const ignoredDirectoryNames = new Set(['dist', 'node_modules', '.git', '.atm-temp', 'temp', 'release', 'coverage']);

const occurrences = new Map<string, ErrorCodeOccurrence>();

for (const sourceRoot of sourceRoots) {
  for (const filePath of walk(sourceRoot)) {
    if (!filePath.endsWith('.ts')) {
      continue;
    }

    const text = readFileSync(filePath, 'utf8');
    const lines = text.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      codePattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = codePattern.exec(line)) !== null) {
        if (!occurrences.has(match[0])) {
          occurrences.set(match[0], {
            code: match[0],
            filePath: path.relative(root, filePath).replace(/\\/g, '/'),
            lineNumber: index + 1,
            context: trimContext(line)
          });
        }
      }
    }
  }
}

if (occurrences.size === 0) {
  throw new Error('no ATM_* error codes found in source tree');
}

const rows = [...occurrences.values()]
  .sort((left, right) => left.code.localeCompare(right.code))
  .map((occurrence) => {
    const location = `${occurrence.filePath}:${occurrence.lineNumber}`;
    return `| \`${escapeTableCell(occurrence.code)}\` | \`${escapeTableCell(location)}\` | ${escapeTableCell(occurrence.context)} |`;
  });

const markdown = [
  '# ATM Error Codes',
  '',
  'Generated from `packages/`, `scripts/`, `tests/`, and `examples/` TypeScript sources.',
  '',
  'Regenerate with `npm run generate:error-codes`.',
  '',
  '| Code | Location | Context |',
  '| --- | --- | --- |',
  ...rows,
  ''
].join('\n');

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, markdown, 'utf8');
console.log(`[generate-error-code-index] wrote ${path.relative(root, outputPath)} (${occurrences.size} codes)`);

function walk(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  const results: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectoryNames.has(entry.name)) {
        continue;
      }
      results.push(...walk(entryPath));
      continue;
    }
    results.push(entryPath);
  }
  return results;
}

function trimContext(line: string): string {
  return line.trim();
}

function escapeTableCell(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/\|/g, '&#124;')
    .replace(/`/g, '&#96;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
