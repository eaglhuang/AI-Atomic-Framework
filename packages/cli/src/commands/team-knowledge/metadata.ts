import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { KnowledgeIndex, KnowledgeIndexEntry, KnowledgeMetadata, KnowledgeShardRetention } from './types.ts';
import {
  evaluateRuntimeBudget,
  fileSize,
  isKnowledgeShardFile,
  isRuntimePrunableCache,
  resolveBudgetOptions,
  resolveKnowledgeOutputs,
  walkFiles
} from './runtime-utils.ts';
import { normalizePath, normalizeWhitespace, stripMarkdown } from './text-utils.ts';

export function buildKnowledgeIndex(cwd: string, scope: string): KnowledgeIndex {
  const root = path.join(cwd, '.atm', 'knowledge');
  const files = existsSync(root) ? walkFiles(root).filter((file) => /\.(md|json)$/i.test(file)) : [];
  const entries = files.map((file) => buildIndexEntry(cwd, file));
  return {
    schemaId: 'atm.teamKnowledgeIndex.v1',
    generatedAt: new Date().toISOString(),
    scope,
    advisoryOnly: true,
    canonicalRoot: '.atm/knowledge',
    entries
  };
}

export function buildKnowledgeStats(cwd: string, options: Record<string, unknown>) {
  const outputs = resolveKnowledgeOutputs(cwd);
  const shardFiles = existsSync(outputs.canonicalRoot) ? walkFiles(outputs.canonicalRoot).filter(isKnowledgeShardFile) : [];
  const runtimeFiles = existsSync(outputs.runtimeRoot) ? walkFiles(outputs.runtimeRoot) : [];
  const shards = shardFiles.map((file) => inspectKnowledgeShard(cwd, file));
  const runtimeFileStats = runtimeFiles.map((file) => ({
    path: normalizePath(path.relative(cwd, file)),
    bytes: fileSize(file),
    prunable: isRuntimePrunableCache(normalizePath(path.relative(cwd, file)))
  }));
  const runtimeCacheBytes = runtimeFileStats.reduce((sum, entry) => sum + entry.bytes, 0);
  const runtimeIndexBytes = existsSync(outputs.indexPath) ? fileSize(outputs.indexPath) : 0;
  const embeddingCacheBytes = runtimeFileStats
    .filter((entry) => /embedding|vector/i.test(entry.path))
    .reduce((sum, entry) => sum + entry.bytes, 0);
  const budgetOptions = resolveBudgetOptions(options);
  const budget = evaluateRuntimeBudget(runtimeCacheBytes, budgetOptions.warningBytes, budgetOptions.hardLimitBytes);

  return {
    schemaId: 'atm.teamKnowledgeStats.v1',
    advisoryOnly: true,
    canonicalRoot: outputs.canonicalRootRelative,
    runtimeRoot: outputs.runtimeRootRelative,
    shardCount: shards.length,
    runtimeIndexBytes,
    runtimeCacheBytes,
    embeddingCacheBytes,
    staleShardCount: shards.filter((entry) => entry.reasons.includes('status:stale')).length,
    supersededShardCount: shards.filter((entry) => entry.supersededBy || entry.reasons.includes('status:superseded')).length,
    archiveCandidateCount: shards.filter((entry) => entry.archiveCandidate).length,
    budget,
    shards,
    runtimeFiles: runtimeFileStats
  };
}

export function inspectKnowledgeShard(cwd: string, file: string): KnowledgeShardRetention {
  const relativePath = normalizePath(path.relative(cwd, file));
  const body = readFileSync(file, 'utf8');
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(relativePath);
  const status = extractField(body, ['status', 'retention'])?.toLowerCase() ?? null;
  const supersededBy = extractField(body, ['supersededBy', 'superseded-by', 'replacedBy', 'replaced-by']) ?? null;
  const reasons: string[] = [];
  if (status && /stale|deprecated|retired|archive|superseded/.test(status)) {
    reasons.push(`status:${status.includes('superseded') ? 'superseded' : status.includes('stale') ? 'stale' : 'archive-candidate'}`);
  }
  if (supersededBy) {
    reasons.push('superseded-by');
  }
  if (/stale|deprecated|retired|archive|superseded/i.test(relativePath)) {
    reasons.push('path-marker');
  }
  return {
    path: relativePath,
    title,
    status,
    supersededBy,
    archiveCandidate: reasons.length > 0,
    reasons,
    bytes: fileSize(file)
  };
}

export function buildIndexEntry(cwd: string, file: string): KnowledgeIndexEntry {
  const relativePath = normalizePath(path.relative(cwd, file));
  const body = readFileSync(file, 'utf8');
  const parsed = extractMetadata(body, relativePath);
  return {
    id: relativePath,
    path: relativePath,
    title: parsed.title,
    metadata: parsed.metadata,
    searchText: normalizeWhitespace(`${parsed.title} ${relativePath} ${JSON.stringify(parsed.metadata)} ${stripMarkdown(body)}`).slice(0, 12000)
  };
}

export function extractMetadata(body: string, relativePath: string): { title: string; metadata: KnowledgeMetadata } {
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(relativePath);
  const metadata: KnowledgeMetadata = {
    repo: extractField(body, ['repo', 'repository']),
    channel: extractField(body, ['channel']),
    domain: extractField(body, ['domain']),
    paths: extractListField(body, ['paths', 'path']),
    atoms: extractListField(body, ['atoms', 'atom']),
    validators: extractListField(body, ['validators', 'validator'])
  };
  return { title, metadata };
}

function extractField(body: string, names: string[]): string | undefined {
  for (const name of names) {
    const match = body.match(new RegExp(`^\\s*${name}\\s*[:=]\\s*(.+)$`, 'im'));
    if (match?.[1]) {
      return cleanScalar(match[1]);
    }
  }
  return undefined;
}

function extractListField(body: string, names: string[]): string[] {
  const raw = extractField(body, names);
  if (!raw) {
    return [];
  }
  return raw.split(/[,;]/).map(cleanScalar).filter(Boolean);
}

function cleanScalar(value: string): string {
  return value.trim().replace(/^["'\[]+|["'\]]+$/g, '').trim();
}
