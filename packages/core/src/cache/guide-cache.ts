import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface CacheKey {
  goal: string;
  glob: string;
  gitCommitHash: string;
  toolVersion: string;
  policyHash: string;
}

export interface CacheEntry {
  schemaId: 'atm.guideCacheEntry';
  cacheKey: string;
  keyComponents: CacheKey;
  cachedAt: string;
  contentHash: string;
  result: unknown;
}

export interface CacheIndexEntry {
  cacheKey: string;
  cachedAt: string;
  goal: string;
  gitCommitHash: string;
}

export interface CacheIndex {
  entries: Record<string, CacheIndexEntry>;
  updatedAt: string;
}

export interface CacheStatus {
  enabled: boolean;
  entryCount: number;
  totalBytes: number;
  oldestEntry: string | null;
  newestEntry: string | null;
}

const CACHE_MAX_AGE_DAYS = 7;
const CACHE_DIR_NAME = '.atm-guide-cache';
const INDEX_FILENAME = 'index.json';

export function getCacheDir(repositoryRoot: string): string {
  return path.join(repositoryRoot, CACHE_DIR_NAME);
}

export function isCacheEnabled(repositoryRoot: string): boolean {
  const flagsPath = path.join(repositoryRoot, '.atm', 'runtime', 'feature-flags.json');
  if (!existsSync(flagsPath)) return false;
  try {
    const flags = JSON.parse(readFileSync(flagsPath, 'utf-8'));
    return flags.guideCacheEnabled === true;
  } catch {
    return false;
  }
}

export function enableGuideCache(repositoryRoot: string): void {
  const flagsPath = path.join(repositoryRoot, '.atm', 'runtime', 'feature-flags.json');
  mkdirSync(path.dirname(flagsPath), { recursive: true });
  let existing: Record<string, unknown> = {};
  if (existsSync(flagsPath)) {
    try { existing = JSON.parse(readFileSync(flagsPath, 'utf-8')); } catch { /* start fresh */ }
  }
  writeFileSync(flagsPath, JSON.stringify({
    ...existing,
    guideCacheEnabled: true,
    guideCacheEnabledAt: new Date().toISOString()
  }, null, 2) + '\n');
}

export function disableGuideCache(repositoryRoot: string): void {
  const flagsPath = path.join(repositoryRoot, '.atm', 'runtime', 'feature-flags.json');
  if (!existsSync(flagsPath)) return;
  try {
    const flags = JSON.parse(readFileSync(flagsPath, 'utf-8'));
    flags.guideCacheEnabled = false;
    writeFileSync(flagsPath, JSON.stringify(flags, null, 2) + '\n');
  } catch { /* ignore */ }
}

export function computeCacheKey(components: CacheKey): string {
  const canonical = [
    components.goal,
    components.glob,
    components.gitCommitHash,
    components.toolVersion,
    components.policyHash
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

export function getGitCommitHash(repositoryRoot: string): string | null {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: repositoryRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return null;
  }
}

export function hasUncommittedChanges(repositoryRoot: string): boolean {
  try {
    const output = execSync('git status --porcelain', {
      cwd: repositoryRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    return output.length > 0;
  } catch {
    return true; // Treat errors as "dirty" for safety
  }
}

export function getPolicyHash(repositoryRoot: string): string {
  const policyPath = path.join(repositoryRoot, '.atm', 'runtime', 'policy.json');
  if (!existsSync(policyPath)) return 'no-policy';
  try {
    const content = readFileSync(policyPath, 'utf-8');
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    return 'policy-unreadable';
  }
}

export function readCacheEntry(repositoryRoot: string, cacheKey: string): CacheEntry | null {
  const cacheDir = getCacheDir(repositoryRoot);
  const entryPath = path.join(cacheDir, `${cacheKey}.json`);
  if (!existsSync(entryPath)) return null;

  try {
    const content = readFileSync(entryPath, 'utf-8');
    const entry = JSON.parse(content) as CacheEntry;

    // Validate content hash (integrity check)
    const expectedHash = createHash('sha256')
      .update(JSON.stringify(entry.result))
      .digest('hex');
    if (entry.contentHash !== expectedHash) {
      // Corrupted — delete and return null (safe degradation)
      try { rmSync(entryPath); } catch { /* ignore */ }
      return null;
    }

    // Check age
    const cachedAt = new Date(entry.cachedAt).getTime();
    const maxAge = CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() - cachedAt > maxAge) {
      try { rmSync(entryPath); } catch { /* ignore */ }
      return null;
    }

    return entry;
  } catch {
    // Corrupted — safe degradation
    try { rmSync(entryPath); } catch { /* ignore */ }
    return null;
  }
}

export function writeCacheEntry(
  repositoryRoot: string,
  cacheKey: string,
  components: CacheKey,
  result: unknown
): void {
  const cacheDir = getCacheDir(repositoryRoot);
  mkdirSync(cacheDir, { recursive: true });

  const contentHash = createHash('sha256')
    .update(JSON.stringify(result))
    .digest('hex');

  const entry: CacheEntry = {
    schemaId: 'atm.guideCacheEntry',
    cacheKey,
    keyComponents: components,
    cachedAt: new Date().toISOString(),
    contentHash,
    result
  };

  const entryPath = path.join(cacheDir, `${cacheKey}.json`);
  writeFileSync(entryPath, JSON.stringify(entry, null, 2) + '\n');

  // Update index
  updateCacheIndex(repositoryRoot, cacheKey, {
    cacheKey,
    cachedAt: entry.cachedAt,
    goal: components.goal,
    gitCommitHash: components.gitCommitHash
  });
}

export function clearCache(
  repositoryRoot: string,
  options: { goalFilter?: string } = {}
): { clearedEntries: number; freedBytes: number } {
  const cacheDir = getCacheDir(repositoryRoot);
  if (!existsSync(cacheDir)) return { clearedEntries: 0, freedBytes: 0 };

  const index = readCacheIndex(repositoryRoot);
  let clearedEntries = 0;
  let freedBytes = 0;

  for (const [key, meta] of Object.entries(index.entries)) {
    if (options.goalFilter && !meta.goal.includes(options.goalFilter)) continue;

    const entryPath = path.join(cacheDir, `${key}.json`);
    if (existsSync(entryPath)) {
      try {
        freedBytes += statSync(entryPath).size;
        rmSync(entryPath);
        clearedEntries++;
      } catch { /* ignore */ }
    }
    delete index.entries[key];
  }

  saveCacheIndex(repositoryRoot, index);
  return { clearedEntries, freedBytes };
}

export function getCacheStatus(repositoryRoot: string): CacheStatus {
  const enabled = isCacheEnabled(repositoryRoot);
  const cacheDir = getCacheDir(repositoryRoot);

  if (!existsSync(cacheDir)) {
    return { enabled, entryCount: 0, totalBytes: 0, oldestEntry: null, newestEntry: null };
  }

  const index = readCacheIndex(repositoryRoot);
  const entries = Object.values(index.entries);
  const entryCount = entries.length;

  let totalBytes = 0;
  for (const filename of readdirSync(cacheDir)) {
    if (filename.endsWith('.json') && filename !== INDEX_FILENAME) {
      try {
        totalBytes += statSync(path.join(cacheDir, filename)).size;
      } catch { /* ignore */ }
    }
  }

  const timestamps = entries.map((e) => e.cachedAt).sort();
  return {
    enabled,
    entryCount,
    totalBytes,
    oldestEntry: timestamps[0] ?? null,
    newestEntry: timestamps[timestamps.length - 1] ?? null
  };
}

function readCacheIndex(repositoryRoot: string): CacheIndex {
  const indexPath = path.join(getCacheDir(repositoryRoot), INDEX_FILENAME);
  if (!existsSync(indexPath)) return { entries: {}, updatedAt: new Date().toISOString() };
  try {
    return JSON.parse(readFileSync(indexPath, 'utf-8')) as CacheIndex;
  } catch {
    return { entries: {}, updatedAt: new Date().toISOString() };
  }
}

function saveCacheIndex(repositoryRoot: string, index: CacheIndex): void {
  const cacheDir = getCacheDir(repositoryRoot);
  mkdirSync(cacheDir, { recursive: true });
  index.updatedAt = new Date().toISOString();
  writeFileSync(path.join(cacheDir, INDEX_FILENAME), JSON.stringify(index, null, 2) + '\n');
}

function updateCacheIndex(repositoryRoot: string, key: string, entry: CacheIndexEntry): void {
  const index = readCacheIndex(repositoryRoot);
  index.entries[key] = entry;
  saveCacheIndex(repositoryRoot, index);
}
