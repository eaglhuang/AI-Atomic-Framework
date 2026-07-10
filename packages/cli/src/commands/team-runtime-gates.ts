import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export type TeamRuntimeGateFinding = {
  code: 'ATM_TEAM_GIT_OWNER_REQUIRED' | 'ATM_TEAM_WRITE_SCOPE_EXCEEDED';
  detail: string;
  teamRunId: string;
  teamRunIds?: string[];
  taskId: string | null;
  taskIds?: string[];
  actorId: string | null;
  files: string[];
  requiredCommand: string;
};

type TeamRunProjection = {
  teamRunId: string;
  taskId: string | null;
  actorId: string | null;
  status: string;
  permissionLeases: Array<{
    permission: string;
    agentId: string;
    paths: string[];
  }>;
};

export function evaluateTeamPreToolGate(input: {
  cwd: string;
  actorId: string | null;
  files: readonly string[];
  command: string | null;
  toolName: string | null;
}): TeamRuntimeGateFinding[] {
  const actorId = normalizeOptional(input.actorId);
  const files = normalizePaths(input.files);
  if (files.length === 0) return [];
  const activeRuns = listActiveTeamRunProjections(input.cwd);
  const findings: TeamRuntimeGateFinding[] = [];
  for (const run of activeRuns) {
    const fileWriteLeases = run.permissionLeases.filter((lease) => lease.permission === 'file.write');
    if (fileWriteLeases.length === 0) continue;
    const actorLeases = actorId
      ? fileWriteLeases.filter((lease) => lease.agentId === actorId)
      : fileWriteLeases;
    const allowedPaths = actorLeases.flatMap((lease) => lease.paths);
    const blockedFiles = files.filter((file) => !isPathAllowedByAny(file, allowedPaths));
    if (blockedFiles.length > 0) {
      findings.push({
        code: 'ATM_TEAM_WRITE_SCOPE_EXCEEDED',
        detail: `Active Team run ${run.teamRunId} requires write tools to stay inside file.write lease paths.`,
        teamRunId: run.teamRunId,
        taskId: run.taskId,
        actorId,
        files: blockedFiles,
        requiredCommand: `node atm.mjs team lease --team ${run.teamRunId} --actor ${actorId ?? '<actor>'} --permission file.write --paths "<paths>" --json`
      });
    }
  }
  return findings;
}

export function evaluateTeamPreCommitGate(input: {
  cwd: string;
  actorId: string | null;
  stagedFiles: readonly string[];
}): TeamRuntimeGateFinding[] {
  const actorId = normalizeOptional(input.actorId);
  const stagedFiles = normalizePaths(input.stagedFiles);
  if (stagedFiles.length === 0) return [];
  const activeRuns = listActiveTeamRunProjections(input.cwd);
  const findings: TeamRuntimeGateFinding[] = [];
  const gitOwnerBlockedRuns: TeamRunProjection[] = [];
  for (const run of activeRuns) {
    const gitOwners = new Set(run.permissionLeases
      .filter((lease) => lease.permission === 'git.write')
      .map((lease) => lease.agentId));
    gitOwners.add('coordinator');
    if (run.actorId) gitOwners.add(run.actorId);
    if (!actorId || !gitOwners.has(actorId)) {
      gitOwnerBlockedRuns.push(run);
    }
  }
  if (gitOwnerBlockedRuns.length === 1) {
    const run = gitOwnerBlockedRuns[0];
    findings.push({
      code: 'ATM_TEAM_GIT_OWNER_REQUIRED',
      detail: `Active Team run ${run.teamRunId} only allows Coordinator/git.write owner to commit.`,
      teamRunId: run.teamRunId,
      teamRunIds: [run.teamRunId],
      taskId: run.taskId,
      taskIds: normalizePaths(run.taskId ? [run.taskId] : []),
      actorId,
      files: stagedFiles,
      requiredCommand: `ATM_COMMIT_ACTOR_ID=coordinator git commit`
    });
  } else if (gitOwnerBlockedRuns.length > 1) {
    const teamRunIds = normalizePaths(gitOwnerBlockedRuns.map((run) => run.teamRunId));
    const taskIds = normalizePaths(gitOwnerBlockedRuns.map((run) => run.taskId ?? '').filter(Boolean));
    findings.push({
      code: 'ATM_TEAM_GIT_OWNER_REQUIRED',
      detail: `Multiple active Team runs only allow Coordinator/git.write owners to commit. Runs: ${teamRunIds.join(', ')}.`,
      teamRunId: teamRunIds[0],
      teamRunIds,
      taskId: taskIds[0] ?? null,
      taskIds,
      actorId,
      files: stagedFiles,
      requiredCommand: `ATM_COMMIT_ACTOR_ID=coordinator git commit`
    });
  }
  return findings;
}

function listActiveTeamRunProjections(cwd: string): TeamRunProjection[] {
  const directory = path.join(path.resolve(cwd), '.atm', 'runtime', 'team-runs');
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => readTeamRunProjection(path.join(directory, entry)))
    .filter((run): run is TeamRunProjection => run !== null && run.status === 'active');
}

function readTeamRunProjection(filePath: string): TeamRunProjection | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    return {
      teamRunId: String(parsed.teamRunId ?? '').trim(),
      taskId: normalizeOptional(parsed.taskId),
      actorId: normalizeOptional(parsed.actorId),
      status: String(parsed.status ?? '').trim(),
      permissionLeases: normalizePermissionLeases(parsed.permissionLeases ?? parsed.leases)
    };
  } catch {
    return null;
  }
}

function normalizePermissionLeases(value: unknown): TeamRunProjection['permissionLeases'] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const record = entry as Record<string, unknown>;
    const permission = String(record.permission ?? '').trim();
    const agentId = String(record.agentId ?? '').trim();
    if (!permission || !agentId) return null;
    return {
      permission,
      agentId,
      paths: normalizePaths(Array.isArray(record.paths) ? record.paths.map(String) : [])
    };
  }).filter((entry): entry is TeamRunProjection['permissionLeases'][number] => entry !== null);
}

function normalizePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((entry) => String(entry).trim().replace(/\\/g, '/')).filter(Boolean))].sort();
}

function normalizeOptional(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function isPathAllowedByAny(file: string, allowedPaths: readonly string[]): boolean {
  return allowedPaths.some((allowed) => isPathAllowed(file, allowed));
}

function isPathAllowed(file: string, allowed: string): boolean {
  const normalizedFile = file.replace(/\\/g, '/');
  const normalizedAllowed = allowed.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalizedAllowed) return false;
  if (normalizedAllowed.endsWith('/**')) {
    const prefix = normalizedAllowed.slice(0, -3).replace(/\/+$/, '');
    return normalizedFile === prefix || normalizedFile.startsWith(`${prefix}/`);
  }
  return normalizedFile === normalizedAllowed || normalizedFile.startsWith(`${normalizedAllowed}/`);
}
