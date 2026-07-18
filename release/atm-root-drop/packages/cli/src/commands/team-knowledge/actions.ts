import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message, readJsonFile } from '../shared.ts';
import type { KnowledgeIndex } from './types.ts';
import type { KnowledgePermissionDecision } from './permission.ts';
import { buildKnowledgeIndex, buildKnowledgeStats } from './metadata.ts';
import { applyHybridRerank, buildFilters, buildHybridRequest, deriveQueryText, rankKnowledgeHits } from './ranking.ts';
import { buildManifest, isInsidePath, isRuntimePrunableCache, parsePositiveInteger, resolveKnowledgeOutputs } from './runtime-utils.ts';

export function runKnowledgeBuild(options: Record<string, unknown>, cwd: string, permission: KnowledgePermissionDecision) {
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
      permission,
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

export function runKnowledgeQuery(options: Record<string, unknown>, cwd: string, permission: KnowledgePermissionDecision) {
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
        permission,
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
    ? applyHybridRerank({ cwd, outputs, query, lexicalShortlist, top })
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
      permission,
      indexStatus: 'ready',
      query,
      filters,
      top,
      hybridRetrieval: rerank.evidence,
      hits
    }
  });
}

export function runKnowledgeStats(options: Record<string, unknown>, cwd: string, permission: KnowledgePermissionDecision) {
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
      permission,
      ...stats
    }
  });
}

export function runKnowledgeCompact(options: Record<string, unknown>, cwd: string, permission: KnowledgePermissionDecision) {
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
      permission,
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
