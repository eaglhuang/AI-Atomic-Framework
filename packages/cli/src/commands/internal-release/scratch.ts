import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { forbiddenAdopterScratchPaths } from './constants.ts';
import type { InternalReleaseSyncOptions, ScratchGuardReport } from './types.ts';

export function cleanForbiddenAdopterScratch(
  repoPath: string,
  options: Pick<InternalReleaseSyncOptions, 'dryRun' | 'keepTemp'>
): ScratchGuardReport {
  const present: string[] = [];
  const removed: string[] = [];
  const kept: string[] = [];
  const errors: string[] = [];
  let fileCount = 0;
  let freedBytes = 0;
  for (const relativePath of forbiddenAdopterScratchPaths) {
    const absolutePath = path.join(repoPath, relativePath);
    if (!existsSync(absolutePath)) continue;
    present.push(relativePath);
    const summary = summarizePath(absolutePath);
    fileCount += summary.fileCount;
    if (options.dryRun || options.keepTemp) {
      kept.push(relativePath);
      continue;
    }
    try {
      rmSync(absolutePath, { recursive: true, force: true });
      removed.push(relativePath);
      freedBytes += summary.totalBytes;
    } catch (error) {
      errors.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    forbiddenRelativePaths: forbiddenAdopterScratchPaths,
    present,
    removed,
    kept,
    fileCount,
    freedBytes,
    dryRun: options.dryRun,
    keepTemp: options.keepTemp,
    errors,
    ok: errors.length === 0
  };
}

export function createEmptyScratchGuard(options: Pick<InternalReleaseSyncOptions, 'dryRun' | 'keepTemp'>): ScratchGuardReport {
  return {
    forbiddenRelativePaths: forbiddenAdopterScratchPaths,
    present: [],
    removed: [],
    kept: [],
    fileCount: 0,
    freedBytes: 0,
    dryRun: options.dryRun,
    keepTemp: options.keepTemp,
    errors: [],
    ok: true
  };
}

function summarizePath(absolutePath: string): { readonly fileCount: number; readonly totalBytes: number } {
  const stats = statSync(absolutePath);
  if (!stats.isDirectory()) {
    return { fileCount: 1, totalBytes: stats.size };
  }
  let fileCount = 0;
  let totalBytes = 0;
  for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
    const child = path.join(absolutePath, entry.name);
    const summary = summarizePath(child);
    fileCount += summary.fileCount;
    totalBytes += summary.totalBytes;
  }
  return { fileCount, totalBytes };
}
