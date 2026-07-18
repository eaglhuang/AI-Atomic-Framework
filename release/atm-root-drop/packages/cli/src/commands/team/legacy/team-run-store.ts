import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  CliError,
  readJsonFile,
  writeJsonFile
} from '../../shared.ts';
import type {
  PermissionLease,
  TeamGovernanceRuntimeFields,
  TeamPermissionLeaseSummary
} from './types.ts';

interface CompactRunInput {
  teamRunId?: unknown;
  taskId?: unknown;
  recipeId?: unknown;
  actorId?: unknown;
  status?: unknown;
  roles?: unknown[];
  agents?: unknown[];
  leases?: unknown[];
  permissionLeases?: unknown[];
  brokerSubagent?: {
    enabled?: boolean;
    decisionSurface?: unknown;
    stewardId?: unknown;
    evidenceRequired?: unknown;
  };
  runtimeContract?: {
    brokerSubagent?: {
      enabled?: boolean;
      decisionSurface?: unknown;
      stewardId?: unknown;
      evidenceRequired?: unknown;
    };
    commitLane?: {
      serializedBy?: unknown;
      ownerRole?: unknown;
    };
    workerAdapter?: {
      authorityBoundary?: {
        gitWrite?: boolean;
        taskLifecycle?: boolean;
        selfClose?: boolean;
      };
    };
  };
  teamSummary?: {
    brokerGovernance?: {
      schemaId?: unknown;
      brokerEvidenceRequired?: unknown;
      commitLaneSerializedBy?: unknown;
      commitLaneOwnerRole?: unknown;
      workerGitWrite?: boolean;
      workerTaskLifecycle?: boolean;
      workerSelfClose?: boolean;
    };
  };
  runtimePilot?: {
    selectedRoles?: unknown;
  };
  agentsSpawned?: boolean;
  governanceRuntime?: Partial<TeamGovernanceRuntimeFields> | null;
  decisionClass?: unknown;
  decisionReason?: unknown;
  requiresHumanSignoff?: unknown;
  requiresAdr?: unknown;
  violationStatus?: unknown;
  escalationTarget?: unknown;
  completedAt?: unknown;
  completedBy?: unknown;
  abandonedAt?: unknown;
  abandonedBy?: unknown;
  lifecycleEvents?: unknown[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export function listTeamRuns(cwd: string) {
  const directory = teamRunsDirectory(cwd);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => readJsonFile(path.join(directory, entry), 'ATM_TEAM_RUN_INVALID'));
}

export function findLatestTeamRunForTask(cwd: string, taskId: string) {
  const runs = listTeamRuns(cwd)
    .filter((run: unknown) => typeof run === 'object' && run !== null && (run as Record<string, unknown>).taskId === taskId)
    .sort((left: unknown, right: unknown) => String((right as Record<string, unknown>).updatedAt ?? (right as Record<string, unknown>).createdAt ?? '').localeCompare(String((left as Record<string, unknown>).updatedAt ?? (left as Record<string, unknown>).createdAt ?? '')));
  return runs[0] ?? null;
}

export function readTeamRun(cwd: string, teamRunId: string) {
  const filePath = path.join(teamRunsDirectory(cwd), `${teamRunId}.json`);
  if (!existsSync(filePath)) {
    throw new CliError('ATM_TEAM_RUN_NOT_FOUND', `Team run not found: ${teamRunId}`, {
      exitCode: 2,
      details: { teamRunId, path: path.relative(cwd, filePath).replace(/\\/g, '/') }
    });
  }
  return readJsonFile(filePath, 'ATM_TEAM_RUN_INVALID');
}

export function writeExistingTeamRun(cwd: string, teamRunId: string, run: Record<string, unknown>) {
  const filePath = path.join(teamRunsDirectory(cwd), `${teamRunId}.json`);
  if (!existsSync(filePath)) {
    throw new CliError('ATM_TEAM_RUN_NOT_FOUND', `Team run not found: ${teamRunId}`, {
      exitCode: 2,
      details: { teamRunId, path: path.relative(cwd, filePath).replace(/\\/g, '/') }
    });
  }
  writeJsonFile(filePath, run);
}

export function teamRunsDirectory(cwd: string) {
  return path.join(cwd, '.atm', 'runtime', 'team-runs');
}

export function createTeamRunId(taskId: string, actorId: string, createdAt: string) {
  const digest = createHash('sha256')
    .update(`${taskId}\n${actorId}\n${createdAt}`)
    .digest('hex')
    .slice(0, 12);
  return `team-${digest}`;
}

export function compactTeamRun(run: Record<string, unknown> | null | undefined) {
  if (!run) return {};
  const r = run as CompactRunInput;
  const brokerGovernance = r.teamSummary?.brokerGovernance ?? null;
  const roles = r.roles;
  const agents = r.agents;
  const leases = r.leases;
  const permissionLeases = r.permissionLeases;
  const brokerSubagent = r.brokerSubagent;
  const runtimeContract = r.runtimeContract;
  const governanceRuntime = r.governanceRuntime ?? null;
  return {
    teamRunId: r.teamRunId,
    taskId: r.taskId,
    recipeId: r.recipeId,
    actorId: r.actorId,
    status: r.status,
    roleCount: Array.isArray(roles) ? roles.length : Array.isArray(agents) ? agents.length : 0,
    leaseCount: Array.isArray(leases) ? leases.length : Array.isArray(permissionLeases) ? permissionLeases.length : 0,
    brokerSubagentEnabled: brokerSubagent?.enabled === true || runtimeContract?.brokerSubagent?.enabled === true,
    brokerDecisionSurface: brokerSubagent?.decisionSurface ?? runtimeContract?.brokerSubagent?.decisionSurface ?? null,
    brokerStewardId: brokerSubagent?.stewardId ?? runtimeContract?.brokerSubagent?.stewardId ?? null,
    brokerGovernanceSummaryId: brokerGovernance?.schemaId ?? null,
    runtimePilotMode: (run as { runtimePilot?: { pilotMode?: unknown } })?.runtimePilot?.pilotMode ?? null,
    runtimePilotRoles: normalizeStringArray(r.runtimePilot?.selectedRoles),
    decisionClass: governanceRuntime?.decisionClass ?? r.decisionClass ?? null,
    decisionReason: governanceRuntime?.decisionReason ?? r.decisionReason ?? null,
    requiresHumanSignoff: governanceRuntime?.requiresHumanSignoff ?? r.requiresHumanSignoff ?? false,
    requiresAdr: governanceRuntime?.requiresAdr ?? r.requiresAdr ?? false,
    violationStatus: governanceRuntime?.violationStatus ?? r.violationStatus ?? null,
    escalationTarget: governanceRuntime?.escalationTarget ?? r.escalationTarget ?? null,
    brokerEvidenceRequired: normalizeStringArray(
      brokerGovernance?.brokerEvidenceRequired ?? brokerSubagent?.evidenceRequired ?? runtimeContract?.brokerSubagent?.evidenceRequired
    ),
    commitLaneSerializedBy: brokerGovernance?.commitLaneSerializedBy ?? runtimeContract?.commitLane?.serializedBy ?? null,
    commitLaneOwnerRole: brokerGovernance?.commitLaneOwnerRole ?? runtimeContract?.commitLane?.ownerRole ?? null,
    workerGitWrite: brokerGovernance?.workerGitWrite ?? runtimeContract?.workerAdapter?.authorityBoundary?.gitWrite ?? null,
    workerTaskLifecycle: brokerGovernance?.workerTaskLifecycle ?? runtimeContract?.workerAdapter?.authorityBoundary?.taskLifecycle ?? null,
    workerSelfClose: brokerGovernance?.workerSelfClose ?? runtimeContract?.workerAdapter?.authorityBoundary?.selfClose ?? null,
    agentsSpawned: r.agentsSpawned === true,
    completedAt: r.completedAt ?? null,
    completedBy: r.completedBy ?? null,
    abandonedAt: r.abandonedAt ?? null,
    abandonedBy: r.abandonedBy ?? null,
    lifecycleEventCount: Array.isArray(r.lifecycleEvents) ? r.lifecycleEvents.length : 0,
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null
  };
}

export function summarizeTeamPermissionLeases(input: {
  readonly teamRunId: string;
  readonly permission: string;
  readonly leases: readonly PermissionLease[];
}): TeamPermissionLeaseSummary[] {
  return input.leases
    .filter((lease) => lease.permission === input.permission)
    .map((lease) => ({
      permission: lease.permission,
      agentId: lease.agentId,
      paths: [...(lease.paths ?? [])],
      releaseCommand: `node atm.mjs team release --team ${input.teamRunId} --actor ${lease.agentId} --permission ${lease.permission} --json`
    }));
}

export function buildTeamLeaseConflictDetails(input: {
  readonly teamRunId: string;
  readonly permission: string;
  readonly requestedOwner: string;
  readonly conflict: PermissionLease;
  readonly currentLeases: readonly PermissionLease[];
}) {
  const activeLeases = summarizeTeamPermissionLeases({
    teamRunId: input.teamRunId,
    permission: input.permission,
    leases: input.currentLeases
  });
  const currentOwnerPaths = [...(input.conflict.paths ?? [])];
  const currentOwnerReleaseCommand = `node atm.mjs team release --team ${input.teamRunId} --actor ${input.conflict.agentId} --permission ${input.permission} --json`;
  return {
    teamRunId: input.teamRunId,
    permission: input.permission,
    currentOwner: input.conflict.agentId,
    currentOwnerPaths,
    currentOwnerReleaseCommand,
    requestedOwner: input.requestedOwner,
    activeLeases,
    requiredCommand: currentOwnerReleaseCommand
  };
}

export function buildTeamLeaseNotFoundDetails(input: {
  readonly teamRunId: string;
  readonly permission: string;
  readonly actorId: string;
  readonly currentLeases: readonly PermissionLease[];
}) {
  const activeLeases = summarizeTeamPermissionLeases({
    teamRunId: input.teamRunId,
    permission: input.permission,
    leases: input.currentLeases
  });
  return {
    teamRunId: input.teamRunId,
    permission: input.permission,
    actorId: input.actorId,
    activeLeases,
    holderCount: activeLeases.length,
    requiredCommand: activeLeases[0]?.releaseCommand ?? null
  };
}

export function normalizePermissionLeaseRecords(value: unknown): PermissionLease[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry): PermissionLease | null => {
    const record = entry as { permission?: unknown; agentId?: unknown; paths?: unknown };
    const permission = String(record.permission ?? '').trim();
    const agentId = String(record.agentId ?? '').trim();
    if (!permission || !agentId) return null;
    return {
      permission,
      agentId,
      paths: normalizeStringArray(record.paths)
    };
  }).filter((entry): entry is PermissionLease => entry !== null);
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}
