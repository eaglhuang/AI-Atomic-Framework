import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { KnowledgeIndex, RuntimeBudgetStatus } from './types.ts';
import { normalizePath } from './text-utils.ts';

const DEFAULT_RUNTIME_WARNING_BYTES = 5 * 1024 * 1024;
const DEFAULT_RUNTIME_HARD_LIMIT_BYTES = 20 * 1024 * 1024;

export function parsePositiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

export function parseByteLimit(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function evaluateRuntimeBudget(runtimeCacheBytes: number, warningBytes: number, hardLimitBytes: number): {
  runtimeCacheBytes: number;
  warningBytes: number;
  hardLimitBytes: number;
  status: RuntimeBudgetStatus;
  diagnostic: string;
} {
  const status: RuntimeBudgetStatus = runtimeCacheBytes >= hardLimitBytes
    ? 'hard-limit'
    : runtimeCacheBytes >= warningBytes
      ? 'warning'
      : 'ok';
  const diagnostic = status === 'ok'
    ? 'Runtime knowledge cache is within the configured disk budget.'
    : status === 'warning'
      ? 'Runtime knowledge cache crossed the warning threshold; run compact dry-run and review prunable cache files.'
      : 'Runtime knowledge cache crossed the hard limit; prune generated runtime cache before relying on fresh advisory knowledge.';
  return { runtimeCacheBytes, warningBytes, hardLimitBytes, status, diagnostic };
}

export function resolveKnowledgeOutputs(cwd: string) {
  const canonicalRoot = path.join(cwd, '.atm', 'knowledge');
  const runtimeRoot = path.join(cwd, '.atm', 'runtime', 'knowledge');
  const manifestPath = path.join(runtimeRoot, 'team-knowledge-manifest.json');
  const indexPath = path.join(runtimeRoot, 'team-knowledge-index.json');
  const embeddingCachePath = path.join(runtimeRoot, 'team-knowledge-embeddings.json');
  return {
    canonicalRoot,
    canonicalRootRelative: '.atm/knowledge',
    runtimeRoot,
    runtimeRootRelative: '.atm/runtime/knowledge',
    manifestPath,
    indexPath,
    embeddingCachePath,
    manifestRelative: '.atm/runtime/knowledge/team-knowledge-manifest.json',
    indexRelative: '.atm/runtime/knowledge/team-knowledge-index.json',
    embeddingCacheRelative: '.atm/runtime/knowledge/team-knowledge-embeddings.json'
  };
}

export function buildManifest(index: KnowledgeIndex, outputs: ReturnType<typeof resolveKnowledgeOutputs>) {
  return {
    schemaId: 'atm.teamKnowledgeManifest.v1',
    advisoryOnly: true,
    generatedAt: index.generatedAt,
    shardCount: index.entries.length,
    canonicalRoot: outputs.canonicalRootRelative,
    lexicalIndex: outputs.indexRelative,
    optionalEmbeddingCache: outputs.embeddingCacheRelative
  };
}

export function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

export function isKnowledgeShardFile(file: string): boolean {
  return /\.(md|json)$/i.test(file);
}

export function fileSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

export function isRuntimePrunableCache(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  if (!normalized.startsWith('.atm/runtime/knowledge/')) {
    return false;
  }
  if (normalized.endsWith('/team-knowledge-index.json') || normalized.endsWith('/team-knowledge-manifest.json')) {
    return false;
  }
  return /embedding|vector|cache|tmp|scratch/i.test(normalized);
}

export function isInsidePath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveBudgetOptions(options: Record<string, unknown>) {
  const warningBytes = parseByteLimit(options.warningBytes ?? options['warning-bytes'], DEFAULT_RUNTIME_WARNING_BYTES);
  const hardLimitBytes = parseByteLimit(options.budgetBytes ?? options['budget-bytes'], DEFAULT_RUNTIME_HARD_LIMIT_BYTES);
  return { warningBytes, hardLimitBytes: Math.max(warningBytes, hardLimitBytes) };
}
