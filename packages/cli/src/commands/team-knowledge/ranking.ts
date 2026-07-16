import { existsSync } from 'node:fs';
import path from 'node:path';
import { CliError, readJsonFile } from '../shared.ts';
import type { KnowledgeEmbeddingCache, KnowledgeHit, KnowledgeIndexEntry, KnowledgeMetadata } from './types.ts';
import { resolveKnowledgeOutputs } from './runtime-utils.ts';
import { normalizePath, normalizeWhitespace, readSnippet, stringOption, tokenize } from './text-utils.ts';

export function buildFilters(options: Record<string, unknown>) {
  return {
    repo: stringOption(options.repo),
    channel: stringOption(options.channel),
    domain: stringOption(options.domain),
    path: stringOption(options.path),
    atom: stringOption(options.atom),
    validator: stringOption(options.validator)
  };
}

export function rankKnowledgeHits(
  entries: KnowledgeIndexEntry[],
  query: string,
  filters: ReturnType<typeof buildFilters>,
  top: number,
  cwd: string
): KnowledgeHit[] {
  const tokens = tokenize(query);
  return entries
    .filter((entry) => metadataMatches(entry.metadata, filters))
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens, query) }))
    .filter((hit) => hit.score > 0 || tokens.length === 0)
    .sort((left, right) => right.score - left.score || left.entry.path.localeCompare(right.entry.path))
    .slice(0, top)
    .map((hit) => ({
      path: hit.entry.path,
      title: hit.entry.title,
      score: hit.score,
      metadata: hit.entry.metadata,
      snippet: readSnippet(path.join(cwd, hit.entry.path), tokens)
    }));
}

export function buildHybridRequest(options: Record<string, unknown>): { enabled: boolean } {
  return { enabled: Boolean(options.vectorRerank ?? options['vector-rerank']) };
}

export function applyHybridRerank(input: {
  cwd: string;
  outputs: ReturnType<typeof resolveKnowledgeOutputs>;
  query: string;
  lexicalShortlist: KnowledgeHit[];
  top: number;
}): { hits: KnowledgeHit[]; evidence: Record<string, any> } {
  const cache = readEmbeddingCache(input.outputs.embeddingCachePath);
  if (!cache) {
    return {
      hits: input.lexicalShortlist.slice(0, input.top),
      evidence: {
        requested: true,
        applied: false,
        fallback: 'embedding-cache-missing-or-invalid',
        lexicalBaselineRequired: true,
        lexicalShortlistSize: input.lexicalShortlist.length,
        embeddingCache: input.outputs.embeddingCacheRelative
      }
    };
  }

  const queryVector = vectorizeText(input.query);
  const vectorsByPath = new Map(cache.entries.map((entry) => [normalizePath(entry.path), entry.vector]));
  const reranked = input.lexicalShortlist
    .map((hit) => {
      const vector = vectorsByPath.get(normalizePath(hit.path));
      const semanticScore = vector ? cosineSimilarity(queryVector, vector) : 0;
      return {
        ...hit,
        lexicalScore: hit.score,
        semanticScore,
        rerankApplied: true,
        score: Number((hit.score + semanticScore * 20).toFixed(6))
      };
    })
    .sort((left, right) => right.score - left.score || right.lexicalScore! - left.lexicalScore! || left.path.localeCompare(right.path))
    .slice(0, input.top);

  return {
    hits: reranked,
    evidence: {
      requested: true,
      applied: true,
      fallback: null,
      lexicalBaselineRequired: true,
      lexicalShortlistSize: input.lexicalShortlist.length,
      embeddingCache: input.outputs.embeddingCacheRelative,
      embeddingCount: cache.entries.length
    }
  };
}

export function summarizeHitReason(hit: { metadata?: KnowledgeMetadata; score: number }, taskId: string): string {
  const domains = hit.metadata?.domain ? [`domain ${hit.metadata.domain}`] : [];
  const atoms = hit.metadata?.atoms?.slice(0, 2).map((atom) => `atom ${atom}`) ?? [];
  const parts = [...domains, ...atoms];
  if (parts.length === 0) {
    return `Lexical match for ${taskId}; score ${hit.score}.`;
  }
  return `Matched ${parts.join(', ')}; score ${hit.score}.`;
}

export function deriveQueryText(cwd: string, options: Record<string, unknown>): string {
  const explicit = stringOption(options.query);
  if (explicit) {
    return explicit;
  }
  const taskId = stringOption(options.task);
  if (!taskId) {
    throw new CliError('ATM_TEAM_KNOWLEDGE_QUERY_REQUIRED', 'team knowledge query requires --query <text> or --task <id>.', { exitCode: 2 });
  }
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  const task = existsSync(taskPath) ? readJsonFile(taskPath) as Record<string, unknown> : null;
  if (!task) {
    return taskId;
  }
  return normalizeWhitespace([
    taskId,
    task.title,
    task.summary,
    task.acceptance,
    task.scopePaths,
    task.deliverables,
    task.validators
  ].map((value) => Array.isArray(value) ? value.join(' ') : String(value ?? '')).join(' '));
}

function readEmbeddingCache(cachePath: string): KnowledgeEmbeddingCache | null {
  if (!existsSync(cachePath)) {
    return null;
  }
  const parsed = readJsonFile(cachePath) as KnowledgeEmbeddingCache | null;
  if (!parsed || parsed.schemaId !== 'atm.teamKnowledgeEmbeddingCache.v1' || !Array.isArray(parsed.entries)) {
    return null;
  }
  const entries = parsed.entries.filter(isVectorRecord).map((entry) => ({ path: normalizePath(entry.path), vector: entry.vector }));
  return { ...parsed, entries };
}

function isVectorRecord(entry: unknown): entry is { path: string; vector: Record<string, number> } {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const candidate = entry as { path?: unknown; vector?: unknown };
  return typeof candidate.path === 'string'
    && Boolean(candidate.vector)
    && typeof candidate.vector === 'object'
    && Object.values(candidate.vector as Record<string, unknown>).every((value) => typeof value === 'number' && Number.isFinite(value));
}

function vectorizeText(value: string): Record<string, number> {
  const vector: Record<string, number> = {};
  for (const token of tokenize(value)) {
    vector[token] = (vector[token] ?? 0) + 1;
  }
  return vector;
}

function cosineSimilarity(left: Record<string, number>, right: Record<string, number>): number {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const key of keys) {
    const leftValue = left[key] ?? 0;
    const rightValue = right[key] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function metadataMatches(metadata: KnowledgeMetadata, filters: ReturnType<typeof buildFilters>): boolean {
  if (filters.repo && metadata.repo !== filters.repo) return false;
  if (filters.channel && metadata.channel !== filters.channel) return false;
  if (filters.domain && metadata.domain !== filters.domain) return false;
  if (filters.path && !metadata.paths.some((entry) => entry.includes(filters.path as string))) return false;
  if (filters.atom && !metadata.atoms.includes(filters.atom)) return false;
  if (filters.validator && !metadata.validators.some((entry) => entry.includes(filters.validator as string))) return false;
  return true;
}

function scoreEntry(entry: KnowledgeIndexEntry, tokens: string[], query: string): number {
  const text = entry.searchText.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (entry.path.toLowerCase().includes(token)) score += 5;
    if (entry.title.toLowerCase().includes(token)) score += 4;
    if (text.includes(token)) score += 1;
  }
  if (query && text.includes(query.toLowerCase())) {
    score += 10;
  }
  return score;
}
