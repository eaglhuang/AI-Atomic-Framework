
import { CliError, makeResult, message } from '../../shared.ts';
import { teamPermissionCatalog, type TeamLifecycleAction } from './types.ts';
import { buildTeamLeaseConflictDetails, buildTeamLeaseNotFoundDetails, compactTeamRun, normalizePermissionLeaseRecords, readTeamRun, writeExistingTeamRun } from './team-run-store.ts';
import { uniqueStrings } from './team-utils.ts';

export function normalizeTeamLifecyclePaths(value: unknown): string[] {
  return uniqueStrings(String(value ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/\\/g, '/'))
    .filter(Boolean));
}

export function runTeamLifecycleAction(input: {
  cwd: string;
  action: TeamLifecycleAction;
  teamRunId: string;
  actorId: string;
  permission: string;
  paths: string[];
  reason: string;
}) {
  if (!input.teamRunId) {
    throw new CliError('ATM_TEAM_RUN_REQUIRED', `team ${input.action} requires --team <id>.`, { exitCode: 2 });
  }
  if (!input.actorId) {
    throw new CliError('ATM_TEAM_ACTOR_REQUIRED', `team ${input.action} requires --actor <id>.`, { exitCode: 2 });
  }
  if ((input.action === 'lease' || input.action === 'release') && !input.permission) {
    throw new CliError('ATM_TEAM_PERMISSION_REQUIRED', `team ${input.action} requires --permission <id>.`, { exitCode: 2 });
  }

  if (input.action === 'lease' || input.action === 'release') {
    const definition = teamPermissionCatalog.find((entry) => entry.id === input.permission);
    if (!definition || definition.hardGate !== true) {
      throw new CliError('ATM_TEAM_PERMISSION_HARD_GATE_BLOCKED', `Permission ${input.permission || '<missing>'} is not registered with a hard gate.`, {
        exitCode: 1,
        details: {
          teamRunId: input.teamRunId,
          permission: input.permission || null,
          gateId: 'ATM_TEAM_PERMISSION_HARD_GATE',
          requiredCommand: 'node atm.mjs team validate --json'
        }
      });
    }
    if (input.action === 'lease' && definition.scopeRequired && input.paths.length === 0) {
      throw new CliError('ATM_TEAM_PERMISSION_SCOPE_REQUIRED', `Permission ${input.permission} requires explicit scoped paths.`, {
        exitCode: 1,
        details: {
          teamRunId: input.teamRunId,
          permission: input.permission,
          gateId: 'ATM_TEAM_PERMISSION_HARD_GATE',
          requiredCommand: `node atm.mjs team lease --team ${input.teamRunId} --actor ${input.actorId} --permission ${input.permission} --paths <scoped-paths> --json`
        }
      });
    }
  }

  const run = readTeamRun(input.cwd, input.teamRunId) as Record<string, unknown>;
  const status = String(run.status ?? '');
  if (status !== 'active') {
    throw new CliError('ATM_TEAM_RUN_NOT_ACTIVE', `Team run ${input.teamRunId} is ${status || 'unknown'}, not active.`, {
      exitCode: 1,
      details: { teamRunId: input.teamRunId, status }
    });
  }

  const now = new Date().toISOString();
  const currentLeases = normalizePermissionLeaseRecords(run.permissionLeases ?? run.leases);
  const lifecycleEvents = Array.isArray(run.lifecycleEvents) ? [...run.lifecycleEvents] : [];
  let nextLeases = currentLeases;

  if (input.action === 'lease') {
    const conflict = currentLeases.find((lease) => lease.permission === input.permission && lease.agentId !== input.actorId);
    if (conflict) {
      throw new CliError('ATM_TEAM_LEASE_CONFLICT', `Permission ${input.permission} is already leased to ${conflict.agentId}.`, {
        exitCode: 1,
        details: buildTeamLeaseConflictDetails({
          teamRunId: input.teamRunId,
          permission: input.permission,
          requestedOwner: input.actorId,
          conflict,
          currentLeases
        })
      });
    }
    const lease = {
      permission: input.permission,
      agentId: input.actorId,
      paths: input.paths
    };
    nextLeases = [
      ...currentLeases.filter((entry) => !(entry.permission === input.permission && entry.agentId === input.actorId)),
      lease
    ];
    lifecycleEvents.push(teamLifecycleEvent('lease.granted', input, now, { lease }));
  }

  if (input.action === 'release') {
    const matched = currentLeases.filter((lease) => lease.permission === input.permission && lease.agentId === input.actorId);
    if (matched.length === 0) {
      throw new CliError('ATM_TEAM_LEASE_NOT_FOUND', `No ${input.permission} lease owned by ${input.actorId} exists on ${input.teamRunId}.`, {
        exitCode: 1,
        details: buildTeamLeaseNotFoundDetails({
          teamRunId: input.teamRunId,
          permission: input.permission,
          actorId: input.actorId,
          currentLeases
        })
      });
    }
    nextLeases = currentLeases.filter((lease) => !(lease.permission === input.permission && lease.agentId === input.actorId));
    lifecycleEvents.push(teamLifecycleEvent('lease.released', input, now, { releasedLeases: matched }));
  }

  if (input.action === 'complete') {
    run.status = 'completed';
    run.completedAt = now;
    run.completedBy = input.actorId;
    run.completionReason = input.reason || null;
    const teamSummary = typeof run.teamSummary === 'object' && run.teamSummary !== null
      ? { ...(run.teamSummary as Record<string, unknown>), closeReady: true }
      : { closeReady: true };
    run.teamSummary = teamSummary;
    lifecycleEvents.push(teamLifecycleEvent('team.completed', input, now));
  }

  if (input.action === 'abandon') {
    run.status = 'abandoned';
    run.abandonedAt = now;
    run.abandonedBy = input.actorId;
    run.abandonReason = input.reason || null;
    const teamSummary = typeof run.teamSummary === 'object' && run.teamSummary !== null
      ? { ...(run.teamSummary as Record<string, unknown>), closeReady: false }
      : { closeReady: false };
    run.teamSummary = teamSummary;
    lifecycleEvents.push(teamLifecycleEvent('team.abandoned', input, now));
  }

  run.leases = nextLeases;
  run.permissionLeases = nextLeases;
  run.lifecycleEvents = lifecycleEvents;
  run.updatedAt = now;
  writeExistingTeamRun(input.cwd, input.teamRunId, run);

  return makeResult({
    ok: true,
    command: 'team',
    cwd: input.cwd,
    messages: [
      message('info', 'ATM_TEAM_LIFECYCLE_UPDATED', `Team run ${input.teamRunId} ${input.action} recorded.`, {
        teamRunId: input.teamRunId,
        action: input.action,
        status: run.status,
        leaseCount: nextLeases.length
      })
    ],
    evidence: {
      action: `team.${input.action}`,
      teamRunId: input.teamRunId,
      actorId: input.actorId,
      permission: input.permission || null,
      paths: input.paths,
      status: run.status,
      leaseCount: nextLeases.length,
      lifecycleEventCount: lifecycleEvents.length,
      teamRun: compactTeamRun(run)
    }
  });
}

function teamLifecycleEvent(type: string, input: {
  action: TeamLifecycleAction;
  teamRunId: string;
  actorId: string;
  permission: string;
  paths: string[];
  reason: string;
}, occurredAt: string, extra: Record<string, unknown> = {}) {
  return {
    schemaId: 'atm.teamRuntimeLifecycleEvent.v1',
    type,
    teamRunId: input.teamRunId,
    actorId: input.actorId,
    permission: input.permission || null,
    paths: input.paths,
    reason: input.reason || null,
    occurredAt,
    ...extra
  };
}
