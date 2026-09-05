import { spawnSync } from 'node:child_process';

const TASK_ID_PATTERN = /\b(?:TASK-[A-Z0-9]+-\d{4}|ATM-BUG-\d{4}-\d{2}-\d{3}|ATM-[A-Z0-9]+-\d{4})\b/gi;

export interface CommitScopePatrolFinding {
  code: 'ATM_DOCTOR_COMMIT_TASK_SCOPE_SPAN';
  commitSha: string;
  pathTaskIds: string[];
  declaredTaskId: string | null;
  paths: string[];
}

export interface CommitScopePatrolResult {
  ok: true;
  scannedCommits: number;
  findings: CommitScopePatrolFinding[];
  advisory: true;
}

function runGit(root: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout : '';
}

function normalizeTaskId(value: string): string {
  return value.toUpperCase();
}

function taskIdsFromPaths(paths: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const filePath of paths) {
    for (const match of filePath.matchAll(TASK_ID_PATTERN)) ids.add(normalizeTaskId(match[0]));
  }
  return [...ids].sort();
}

export function inspectHistoricalCommitScopePatrol(root: string, limit = 200): CommitScopePatrolResult {
  const log = runGit(root, ['log', '--all', '--format=%H%x1f%B%x1e', '-n', String(limit)]);
  const findings: CommitScopePatrolFinding[] = [];
  const records = log.split('\x1e').filter(Boolean);

  for (const record of records) {
    const separator = record.indexOf('\x1f');
    if (separator < 0) continue;
    const commitSha = record.slice(0, separator).trim();
    const body = record.slice(separator + 1);
    const paths = runGit(root, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', commitSha])
      .split(/\r?\n/).map((value) => value.trim().replace(/\\/g, '/')).filter(Boolean);
    const pathTaskIds = taskIdsFromPaths(paths);
    const declaredMatch = body.match(/^ATM-Task:\s*([^\s]+)/im);
    const declaredTaskId = declaredMatch ? normalizeTaskId(declaredMatch[1]) : null;
    const declaredDisagrees = declaredTaskId !== null && pathTaskIds.length > 0 && !pathTaskIds.includes(declaredTaskId);
    if (pathTaskIds.length > 1 || declaredDisagrees) {
      findings.push({ code: 'ATM_DOCTOR_COMMIT_TASK_SCOPE_SPAN', commitSha, pathTaskIds, declaredTaskId, paths });
    }
  }

  return { ok: true, scannedCommits: records.length, findings, advisory: true };
}
