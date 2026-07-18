import { existsSync } from 'node:fs';
import path from 'node:path';
import { readJsonFile } from '../shared.ts';
import type { KnowledgeIndex, TeamKnowledgeSummary } from './types.ts';
import { parsePositiveInteger, resolveKnowledgeOutputs } from './runtime-utils.ts';
import { buildFilters, deriveQueryText, rankKnowledgeHits, summarizeHitReason } from './ranking.ts';

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
