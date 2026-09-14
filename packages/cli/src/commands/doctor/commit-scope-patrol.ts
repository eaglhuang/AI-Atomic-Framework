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
  // Include each commit's changed paths in the same Git process.  The old
  // implementation started one `git diff-tree` child for every commit in the
  // patrol window (up to 200), which made doctor spend seconds in process
  // startup even though the check itself is advisory.
  const log = runGit(root, ['log', '--all', '--root', '--format=%H%x1f%B%x1e', '--name-only', '-n', String(limit)]);
  const findings: CommitScopePatrolFinding[] = [];
  const markers = [...log.matchAll(/(^|\r?\n)([0-9a-f]{40})\x1f/gm)];

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const nextMarker = markers[index + 1];
    const markerPrefix = marker[1] ?? '';
    const start = (marker.index ?? 0) + markerPrefix.length;
    const end = nextMarker?.index ?? log.length;
    const record = log.slice(start, end);
    const separator = record.indexOf('\x1e');
    if (separator < 0) continue;
    const commitSha = marker[2];
    const body = record.slice(41, separator);
    const paths = record.slice(separator + 1)
      .split(/\r?\n/).map((value) => value.trim().replace(/\\/g, '/')).filter(Boolean);
    const pathTaskIds = taskIdsFromPaths(paths);
    const declaredMatch = body.match(/^ATM-Task:\s*([^\s]+)/im);
    const declaredTaskId = declaredMatch ? normalizeTaskId(declaredMatch[1]) : null;
    const declaredDisagrees = declaredTaskId !== null && pathTaskIds.length > 0 && !pathTaskIds.includes(declaredTaskId);
    if (pathTaskIds.length > 1 || declaredDisagrees) {
      findings.push({ code: 'ATM_DOCTOR_COMMIT_TASK_SCOPE_SPAN', commitSha, pathTaskIds, declaredTaskId, paths });
    }
  }

  return { ok: true, scannedCommits: markers.length, findings, advisory: true };
}
