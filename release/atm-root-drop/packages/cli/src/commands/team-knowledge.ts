import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, defineCommandSpec, makeResult, message, parseArgsForCommand, readJsonFile } from './shared.ts';

type KnowledgeMetadata = {
  repo?: string;
  channel?: string;
  domain?: string;
  paths: string[];
  atoms: string[];
  validators: string[];
};

export type TeamKnowledgeSummary = {
  schemaId: 'atm.teamKnowledgeSummary.v1';
  advisoryOnly: true;
  taskId: string;
  indexStatus: 'ready' | 'missing';
  top: number;
  hits: Array<{
    path: string;
    title: string;
    score: number;
    reason: string;
    snippet: string;
  }>;
  followUpCommand: string;
  buildCommand?: string;
};

type KnowledgeIndexEntry = {
  id: string;
  path: string;
  title: string;
  metadata: KnowledgeMetadata;
  searchText: string;
  bodySha256?: string;
};

type KnowledgeIndex = {
  schemaId: 'atm.teamKnowledgeIndex.v1';
  generatedAt: string;
  scope: string;
  advisoryOnly: true;
  canonicalRoot: string;
  entries: KnowledgeIndexEntry[];
};

type KnowledgeHit = {
  path: string;
  title: string;
  score: number;
  metadata: KnowledgeMetadata;
  snippet: string;
  semanticScore?: number;
  lexicalScore?: number;
  rerankApplied?: boolean;
};

type KnowledgeEmbeddingCache = {
  schemaId: 'atm.teamKnowledgeEmbeddingCache.v1';
  generatedAt?: string;
  advisoryOnly?: true;
  entries: Array<{
    path: string;
    vector: Record<string, number>;
  }>;
};

type KnowledgeShardRetention = {
  path: string;
  title: string;
  status: string | null;
  supersededBy: string | null;
  archiveCandidate: boolean;
  reasons: string[];
  bytes: number;
};

type RuntimeBudgetStatus = 'ok' | 'warning' | 'hard-limit';

const DEFAULT_RUNTIME_WARNING_BYTES = 5 * 1024 * 1024;
const DEFAULT_RUNTIME_HARD_LIMIT_BYTES = 20 * 1024 * 1024;

const teamKnowledgeSpec = defineCommandSpec({
  name: 'team knowledge',
  summary: 'Build, query, inspect, or compact the advisory Team Agents knowledge index.',
  positional: [
    { name: 'action', summary: 'Knowledge action. Supports: build, query, stats, compact.' }
  ],
  options: [
    { flag: '--cwd', value: 'path', summary: 'Repository root.' },
    { flag: '--scope', value: 'name', summary: 'Build scope. Currently project.' },
    { flag: '--dry-run', summary: 'Report planned build outputs without writing runtime cache files.' },
    { flag: '--write', summary: 'Write generated runtime cache files under .atm/runtime/knowledge.' },
    { flag: '--task', value: 'id', summary: 'Task id used to derive query text.' },
    { flag: '--query', value: 'text', summary: 'Literal query text.' },
    { flag: '--top', value: 'n', summary: 'Maximum query hits to return.' },
    { flag: '--repo', value: 'name', summary: 'Metadata filter.' },
    { flag: '--channel', value: 'name', summary: 'Metadata filter.' },
    { flag: '--domain', value: 'name', summary: 'Metadata filter.' },
    { flag: '--path', value: 'glob', summary: 'Metadata path filter.' },
    { flag: '--atom', value: 'id', summary: 'Metadata atom filter.' },
    { flag: '--validator', value: 'command', summary: 'Metadata validator filter.' },
    { flag: '--vector-rerank', summary: 'Opt in to runtime-cache hybrid rerank after lexical shortlist ranking.' },
    { flag: '--warning-bytes', value: 'n', summary: 'Runtime cache warning threshold for stats/compact.' },
    { flag: '--budget-bytes', value: 'n', summary: 'Runtime cache hard-limit threshold for stats/compact.' },
    { flag: '--json', summary: 'Return JSON output.' },
    { flag: '--pretty', summary: 'Return pretty JSON output.' },
    { flag: '--help', summary: 'Show help.' }
  ]
});

export async function runTeamKnowledge(argv: string[], inheritedCwd?: string) {
  const parsed = parseArgsForCommand(teamKnowledgeSpec, argv);
  const action = String(parsed.positional[0] ?? 'build').toLowerCase();
  const cwd = path.resolve(String(parsed.options.cwd ?? inheritedCwd ?? process.cwd()));

  if (action === 'build') {
    return runKnowledgeBuild(parsed.options, cwd);
  }
  if (action === 'query') {
    return runKnowledgeQuery(parsed.options, cwd);
  }
  if (action === 'stats') {
    return runKnowledgeStats(parsed.options, cwd);
  }
  if (action === 'compact') {
    return runKnowledgeCompact(parsed.options, cwd);
  }
  throw new CliError('ATM_CLI_USAGE', 'team knowledge supports: build, query, stats, compact', { exitCode: 2 });
}

export function buildTeamKnowledgeSummary(input: {
  cwd: string;
  taskId: string;
  top?: number;
}): TeamKnowledgeSummary {
  const cwd = path.resolve(input.cwd);
  const taskId = input.taskId.trim();
  const top = parsePositiveInteger(input.top, 3, 3);
  const outputs = resolveKnowledgeOutputs(cwd);
  const followUpCommand = `node atm.mjs team knowledge query --task ${taskId} --top ${top} --json`;
  const buildCommand = 'node atm.mjs team knowledge build --scope project --dry-run --json';
  if (!taskId || !existsSync(outputs.indexPath)) {
    return {
      schemaId: 'atm.teamKnowledgeSummary.v1',
      advisoryOnly: true,
      taskId,
      indexStatus: 'missing',
      top,
      hits: [],
      followUpCommand,
      buildCommand
    };
  }
  const index = readJsonFile(outputs.indexPath) as KnowledgeIndex | null;
  if (!index || !Array.isArray(index.entries)) {
    return {
      schemaId: 'atm.teamKnowledgeSummary.v1',
      advisoryOnly: true,
      taskId,
      indexStatus: 'missing',
      top,
      hits: [],
      followUpCommand,
      buildCommand
    };
  }
  const query = deriveQueryText(cwd, { task: taskId });
  const hits = rankKnowledgeHits(index.entries, query, buildFilters({}), top, cwd).map((hit) => ({
    path: hit.path,
    title: hit.title,
    score: hit.score,
    reason: summarizeHitReason(hit, taskId),
    snippet: hit.snippet
  }));
  return {
    schemaId: 'atm.teamKnowledgeSummary.v1',
    advisoryOnly: true,
    taskId,
    indexStatus: 'ready',
    top,
    hits,
    followUpCommand
  };
}

function runKnowledgeBuild(options: Record<string, unknown>, cwd: string) {
  const scope = String(options.scope ?? 'project').trim() || 'project';
  if (scope !== 'project') {
    throw new CliError('ATM_TEAM_KNOWLEDGE_SCOPE_UNSUPPORTED', 'team knowledge build currently supports --scope project only.', {
      exitCode: 2,
      details: { scope }
    });
  }
  const dryRun = Boolean(options['dry-run']) || !Boolean(options.write);
  const index = buildKnowledgeIndex(cwd, scope);
  const outputs = resolveKnowledgeOutputs(cwd);

  if (!dryRun) {
    mkdirSync(path.dirname(outputs.indexPath), { recursive: true });
    writeFileSync(outputs.indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    writeFileSync(outputs.manifestPath, `${JSON.stringify(buildManifest(index, outputs), null, 2)}\n`, 'utf8');
  }

  return makeResult({
    ok: true,
    command: 'team',
    cwd,
    messages: [
      message('info', dryRun ? 'ATM_TEAM_KNOWLEDGE_BUILD_DRY_RUN' : 'ATM_TEAM_KNOWLEDGE_BUILD_WRITTEN', dryRun
        ? 'Team knowledge build dry-run completed. No runtime cache files were written.'
        : 'Team knowledge runtime cache files were written.', {
        shardCount: index.entries.length,
        scope
      })
    ],
    evidence: {
      action: 'knowledge.build',
      advisoryOnly: true,
      dryRun,
      scope,
      canonicalRoot: outputs.canonicalRootRelative,
      plannedOutputs: {
        manifest: outputs.manifestRelative,
        lexicalIndex: outputs.indexRelative
      },
      shardCount: index.entries.length,
      shards: index.entries.map((entry) => ({
        id: entry.id,
        path: entry.path,
        title: entry.title,
        metadata: entry.metadata
      }))
    }
  });
}

function runKnowledgeQuery(options: Record<string, unknown>, cwd: string) {
  const outputs = resolveKnowledgeOutputs(cwd);
  const top = parsePositiveInteger(options.top, 5, 20);
  const query = deriveQueryText(cwd, options);
  const filters = buildFilters(options);
  const hybridRequest = buildHybridRequest(options);

  if (!existsSync(outputs.indexPath)) {
    return makeResult({
      ok: true,
      command: 'team',
      cwd,
      messages: [
        message('warn', 'ATM_TEAM_KNOWLEDGE_INDEX_MISSING', 'Team knowledge index is missing. Run the advisory build command before query ranking.', {
          buildCommand: 'node atm.mjs team knowledge build --scope project --dry-run --json'
        })
      ],
      evidence: {
        action: 'knowledge.query',
        advisoryOnly: true,
        indexStatus: 'missing',
        buildCommand: 'node atm.mjs team knowledge build --scope project --dry-run --json',
        query,
        filters,
        top,
        hybridRetrieval: {
          requested: hybridRequest.enabled,
          applied: false,
          fallback: hybridRequest.enabled ? 'lexical-index-missing' : 'not-requested',
          lexicalBaselineRequired: true
        },
        hits: []
      }
    });
  }

  const index = readJsonFile(outputs.indexPath) as KnowledgeIndex | null;
  if (!index || !Array.isArray(index.entries)) {
    throw new CliError('ATM_TEAM_KNOWLEDGE_INDEX_INVALID', 'Team knowledge index is malformed; rebuild the runtime cache.', {
      details: { indexPath: outputs.indexRelative }
    });
  }
  const lexicalShortlist = rankKnowledgeHits(index.entries, query, filters, hybridRequest.enabled ? Math.min(top * 3, 50) : top, cwd);
  const rerank = hybridRequest.enabled
    ? applyHybridRerank({
      cwd,
      outputs,
      query,
      lexicalShortlist,
      top
    })
    : {
      hits: lexicalShortlist.slice(0, top),
      evidence: {
        requested: false,
        applied: false,
        fallback: 'not-requested',
        lexicalBaselineRequired: true,
        lexicalShortlistSize: lexicalShortlist.length
      }
    };
  const hits = rerank.hits;
  return makeResult({
    ok: true,
    command: 'team',
    cwd,
    messages: [
      message('info', 'ATM_TEAM_KNOWLEDGE_QUERY_READY', 'Team knowledge query completed with advisory-only ranked hits.', {
        hitCount: hits.length,
        top,
        hybridRerank: hybridRequest.enabled,
        hybridApplied: rerank.evidence.applied
      })
    ],
    evidence: {
      action: 'knowledge.query',
      advisoryOnly: true,
      indexStatus: 'ready',
      query,
      filters,
      top,
      hybridRetrieval: rerank.evidence,
      hits
    }
  });
}

function runKnowledgeStats(options: Record<string, unknown>, cwd: string) {
  const stats = buildKnowledgeStats(cwd, options);
  const level = stats.budget.status === 'hard-limit' ? 'error' : stats.budget.status === 'warning' ? 'warn' : 'info';
  const code = stats.budget.status === 'hard-limit'
    ? 'ATM_TEAM_KNOWLEDGE_RUNTIME_BUDGET_HARD_LIMIT'
    : stats.budget.status === 'warning'
      ? 'ATM_TEAM_KNOWLEDGE_RUNTIME_BUDGET_WARNING'
      : 'ATM_TEAM_KNOWLEDGE_STATS_READY';
  return makeResult({
    ok: true,
    command: 'team',
    cwd,
    messages: [
      message(level, code, 'Team knowledge stats completed. Runtime cache budget diagnostics are advisory and explicit.', {
        shardCount: stats.shardCount,
        runtimeCacheBytes: stats.runtimeCacheBytes,
        status: stats.budget.status
      })
    ],
    evidence: {
      action: 'knowledge.stats',
      ...stats
    }
  });
}

function runKnowledgeCompact(options: Record<string, unknown>, cwd: string) {
  const stats = buildKnowledgeStats(cwd, options);
  const outputs = resolveKnowledgeOutputs(cwd);
  const dryRun = Boolean(options['dry-run']) || !Boolean(options.write);
  const runtimePrunableFiles = stats.runtimeFiles.filter((entry) => isRuntimePrunableCache(entry.path));
  const archiveCandidates = stats.shards.filter((entry) => entry.archiveCandidate);
  const prunedRuntimeFiles: string[] = [];

  if (!dryRun) {
    for (const entry of runtimePrunableFiles) {
      const absolutePath = path.resolve(cwd, entry.path);
      if (!isInsidePath(outputs.runtimeRoot, absolutePath)) {
        throw new CliError('ATM_TEAM_KNOWLEDGE_COMPACT_PATH_ESCAPE', 'Knowledge compact refused to prune a path outside .atm/runtime/knowledge.', {
          details: { path: entry.path }
        });
      }
      rmSync(absolutePath, { force: true });
      prunedRuntimeFiles.push(entry.path);
    }
  }

  return makeResult({
    ok: true,
    command: 'team',
    cwd,
    messages: [
      message('info', dryRun ? 'ATM_TEAM_KNOWLEDGE_COMPACT_DRY_RUN' : 'ATM_TEAM_KNOWLEDGE_RUNTIME_CACHE_PRUNED', dryRun
        ? 'Team knowledge compact dry-run completed. Canonical shards were not mutated.'
        : 'Team knowledge compact pruned disposable runtime cache files only. Canonical shards were not mutated.', {
        archiveCandidateCount: archiveCandidates.length,
        runtimePrunableCount: runtimePrunableFiles.length
      })
    ],
    evidence: {
      action: 'knowledge.compact',
      advisoryOnly: true,
      dryRun,
      canonicalMutated: false,
      runtimeCacheMutated: !dryRun,
      prunedRuntimeFiles,
      runtimePrunableFiles,
      archiveCandidates,
      staleShardCount: stats.staleShardCount,
      supersededShardCount: stats.supersededShardCount,
      budget: stats.budget,
      canonicalRoot: stats.canonicalRoot,
      runtimeRoot: stats.runtimeRoot
    }
  });
}

function buildKnowledgeIndex(cwd: string, scope: string): KnowledgeIndex {
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

function buildKnowledgeStats(cwd: string, options: Record<string, unknown>) {
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
  const warningBytes = parseByteLimit(options.warningBytes ?? options['warning-bytes'], DEFAULT_RUNTIME_WARNING_BYTES);
  const hardLimitBytes = parseByteLimit(options.budgetBytes ?? options['budget-bytes'], DEFAULT_RUNTIME_HARD_LIMIT_BYTES);
  const budget = evaluateRuntimeBudget(runtimeCacheBytes, warningBytes, Math.max(warningBytes, hardLimitBytes));

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

function inspectKnowledgeShard(cwd: string, file: string): KnowledgeShardRetention {
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

function buildIndexEntry(cwd: string, file: string): KnowledgeIndexEntry {
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

function extractMetadata(body: string, relativePath: string): { title: string; metadata: KnowledgeMetadata } {
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

function buildFilters(options: Record<string, unknown>) {
  return {
    repo: stringOption(options.repo),
    channel: stringOption(options.channel),
    domain: stringOption(options.domain),
    path: stringOption(options.path),
    atom: stringOption(options.atom),
    validator: stringOption(options.validator)
  };
}

function rankKnowledgeHits(
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

function buildHybridRequest(options: Record<string, unknown>): { enabled: boolean } {
  return { enabled: Boolean(options.vectorRerank ?? options['vector-rerank']) };
}

function applyHybridRerank(input: {
  cwd: string;
  outputs: ReturnType<typeof resolveKnowledgeOutputs>;
  query: string;
  lexicalShortlist: KnowledgeHit[];
  top: number;
}): { hits: KnowledgeHit[]; evidence: Record<string, unknown> } {
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

function readEmbeddingCache(cachePath: string): KnowledgeEmbeddingCache | null {
  if (!existsSync(cachePath)) {
    return null;
  }
  const parsed = readJsonFile(cachePath) as KnowledgeEmbeddingCache | null;
  if (!parsed || parsed.schemaId !== 'atm.teamKnowledgeEmbeddingCache.v1' || !Array.isArray(parsed.entries)) {
    return null;
  }
  const entries = parsed.entries.filter(isVectorRecord).map((entry) => ({
    path: normalizePath(entry.path),
    vector: entry.vector
  }));
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

function summarizeHitReason(hit: { metadata?: KnowledgeMetadata; score: number }, taskId: string): string {
  const domains = hit.metadata?.domain ? [`domain ${hit.metadata.domain}`] : [];
  const atoms = hit.metadata?.atoms?.slice(0, 2).map((atom) => `atom ${atom}`) ?? [];
  const parts = [...domains, ...atoms];
  if (parts.length === 0) {
    return `Lexical match for ${taskId}; score ${hit.score}.`;
  }
  return `Matched ${parts.join(', ')}; score ${hit.score}.`;
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

function deriveQueryText(cwd: string, options: Record<string, unknown>): string {
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

function parsePositiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function parseByteLimit(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function evaluateRuntimeBudget(runtimeCacheBytes: number, warningBytes: number, hardLimitBytes: number): {
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

function stringOption(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function resolveKnowledgeOutputs(cwd: string) {
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

function buildManifest(index: KnowledgeIndex, outputs: ReturnType<typeof resolveKnowledgeOutputs>) {
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

function walkFiles(dir: string): string[] {
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

function isKnowledgeShardFile(file: string): boolean {
  return /\.(md|json)$/i.test(file);
}

function fileSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

function isRuntimePrunableCache(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  if (!normalized.startsWith('.atm/runtime/knowledge/')) {
    return false;
  }
  if (normalized.endsWith('/team-knowledge-index.json') || normalized.endsWith('/team-knowledge-manifest.json')) {
    return false;
  }
  return /embedding|vector|cache|tmp|scratch/i.test(normalized);
}

function isInsidePath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function tokenize(value: string): string[] {
  return Array.from(new Set(value.toLowerCase().split(/[^a-z0-9_.-]+/).map((entry) => entry.trim()).filter((entry) => entry.length >= 2)));
}

function readSnippet(filePath: string, tokens: string[]): string {
  if (!existsSync(filePath)) {
    return '';
  }
  const body = normalizeWhitespace(stripMarkdown(readFileSync(filePath, 'utf8')));
  if (tokens.length === 0) {
    return body.slice(0, 180);
  }
  const lower = body.toLowerCase();
  const first = tokens.map((token) => lower.indexOf(token)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  return body.slice(Math.max(0, first - 60), first + 180).trim();
}

function stripMarkdown(value: string): string {
  return value.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`[\]()]/g, ' ');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}
