import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ignoredDirectoryNames, sourceExtensions } from './types.ts';

export { existsSync };

export function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath: string, value: unknown) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readText(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

export function writeText(filePath: string, value: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, 'utf8');
}

export function walkSourceFiles(repoPath: string): string[] {
  const files: string[] = [];
  walk(repoPath, '');
  return files.sort();

  function walk(root: string, relativeDir: string) {
    const absoluteDir = path.join(root, relativeDir);
    for (const entry of safeReadDir(absoluteDir)) {
      if (ignoredDirectoryNames.has(entry)) {
        continue;
      }
      if (relativeDir === 'atomic_workbench' && (entry === 'reports' || entry === 'refs')) {
        continue;
      }
      const relativePath = path.join(relativeDir, entry);
      const absolutePath = path.join(root, relativePath);
      const stats = statSync(absolutePath);
      if (stats.isDirectory()) {
        walk(root, relativePath);
        continue;
      }
      if (stats.isFile() && sourceExtensions.has(path.extname(entry))) {
        files.push(relativePath.replace(/\\/g, '/'));
      }
    }
  }
}

export function safeReadDir(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}
