/**
 * Path utility helpers for the upgrade command.
 *
 * Extracted from `packages/cli/src/commands/upgrade.ts` per the
 * `upgrade/SPLIT_PLAN.md` Layer 1 split. Pure utilities — no side
 * effects beyond `safeReadJson` / `sha256File`, both of which only
 * read from disk.
 *
 * Surface contract: signatures + behavior are preserved byte-for-byte
 * from the original `upgrade.ts` definitions. Callers see no change.
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { CliError } from '../shared.ts';

export function safeReadJson(filePath: string) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function sha256File(filePath: string) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function resolveRepositoryPath(cwd: string, relativePath: string) {
  const absoluteRoot = path.resolve(cwd);
  const resolvedPath = path.isAbsolute(relativePath)
    ? path.resolve(relativePath)
    : path.resolve(absoluteRoot, normalizeRepositoryRelativePath(relativePath));
  const comparableRoot = absoluteRoot.toLowerCase();
  const comparablePath = resolvedPath.toLowerCase();
  if (comparablePath !== comparableRoot && !comparablePath.startsWith(`${comparableRoot}${path.sep}`)) {
    throw new CliError('ATM_UPGRADE_UNSAFE_PATH', `Unsafe upgrade path: ${relativePath}`, { exitCode: 2 });
  }
  return resolvedPath;
}

export function normalizeRepositoryRelativePath(filePath: string) {
  const normalizedPath = String(filePath ?? '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
  if (!normalizedPath || normalizedPath.startsWith('/') || normalizedPath.includes(':') || normalizedPath === '..' || normalizedPath.startsWith('../') || normalizedPath.includes('/../')) {
    throw new CliError('ATM_UPGRADE_UNSAFE_PATH', `Unsafe upgrade path: ${filePath}`, { exitCode: 2 });
  }
  return normalizedPath;
}

export function requireOptionValue(argv: any, optionIndex: any, optionName: any) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `upgrade requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}

export function collectJsonFiles(rootDir: any): string[] {
  const entries = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...collectJsonFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      entries.push(entryPath);
    }
  }
  return entries;
}
