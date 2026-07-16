import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrokerRunSummary, TaskArtifactSummary } from './types.ts';
import { listActiveTeamRunFiles } from './loaders.ts';

export function collectTaskArtifacts(atmRoot: string, taskIds: string[], teamRunDir: string | null): TaskArtifactSummary[] {
  const closureSet = new Set<string>();
  const normalizedTaskIds = taskIds
    .filter((taskId) => taskId.startsWith('TASK-'))
    .sort((left, right) => left.localeCompare(right));

  if (normalizedTaskIds.length === 0) {
    return [];
  }

  const evidenceDir = path.join(atmRoot, '.atm', 'history', 'evidence');
  if (existsSync(evidenceDir)) {
    for (const fileName of readdirSync(evidenceDir)) {
      if (!fileName.endsWith('.closure-packet.json')) {
        continue;
      }
      const task = fileName.replace(/\.closure-packet\.json$/, '');
      if (task.startsWith('TASK-')) {
        closureSet.add(task);
      }
    }
  }

  const resolvedTeamRunDir = teamRunDir ?? path.join(atmRoot, '.atm', 'runtime', 'team-runs');
  const teamRunsByTask: Record<string, string[]> = {};
  if (existsSync(resolvedTeamRunDir)) {
    for (const fullPath of listActiveTeamRunFiles(resolvedTeamRunDir)) {
      try {
        const run = JSON.parse(readFileSync(fullPath, 'utf8')) as { taskId?: unknown };
        const taskId = typeof run.taskId === 'string' ? run.taskId : null;
        if (!taskId || !taskId.startsWith('TASK-')) {
          continue;
        }
        teamRunsByTask[taskId] ??= [];
        teamRunsByTask[taskId].push(fullPath.replace(/\\/g, '/'));
      } catch {
        // ignore malformed team run file
      }
    }
  }

  return normalizedTaskIds.map((taskId) => {
    return {
      taskId,
      closurePacket: closureSet.has(taskId) ? `.atm/history/evidence/${taskId}.closure-packet.json` : 'n/a',
      teamRuns: (teamRunsByTask[taskId] ?? ['n/a']).join(';')
    };
  });
}


export function parseTaskIdsFromRows(rows: readonly BrokerRunSummary[]): string[] {
  const taskSet = new Set<string>();
  for (const row of rows) {
    for (const task of row.tasks.split(',').map((entry) => entry.trim()).filter(Boolean)) {
      if (task === 'n/a') {
        continue;
      }
      taskSet.add(task);
    }
  }
  return [...taskSet];
}

