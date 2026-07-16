
import { CliError, makeResult, message } from '../../shared.ts';
import { createTeamObservabilityEvent } from '../../../../../core/src/team-runtime/observability.ts';
import { readTeamHandoffArtifacts, teamHandoffHistoryDirectory, teamHandoffRuntimeDirectory, verifyTeamHandoffHistory, verifyTeamHandoffLedger } from '../../../../../core/src/team-runtime/handoff-ledger.ts';
import { teamPermissionCatalog } from './types.ts';
import { appendTeamRuntimeObservabilityEvents, buildDirectTeamRoleInstructions, TEAM_HANDOFF_CONTEXT_MAX_ARTIFACTS } from './provider-execution.ts';
import { normalizePermissionLeaseRecords, readTeamRun } from './team-run-store.ts';
import { readOptionValue } from './team-utils.ts';
export function runTeamHandoff(argv: string[], cwd: string) {
  const action = String(argv[0] ?? 'show').toLowerCase();
  const taskId = readOptionValue(argv, '--task')?.trim();
  const teamRunId = readOptionValue(argv, '--team')?.trim();
  const continuationFrom = readOptionValue(argv, '--continuation-from')?.trim() ?? '';
  const actorId = readOptionValue(argv, '--actor')?.trim() ?? '';
  if (!taskId || !teamRunId || !actorId) throw new CliError('ATM_TEAM_HANDOFF_TASK_RUN_REQUIRED', 'team handoff requires --task, --team, and --actor.', { exitCode: 2 });
  if (!['show', 'context', 'stats', 'materialize'].includes(action)) throw new CliError('ATM_CLI_USAGE', 'team handoff supports: show, context, stats, materialize.', { exitCode: 2 });
  const permission = action === 'materialize' ? 'handoff.materialize' : 'handoff.read';
  assertTeamHandoffHardGate({ cwd, taskId, teamRunId, actorId, permission });
  const integrity = verifyTeamHandoffLedger(cwd, taskId, teamRunId);
  if (!integrity.ok) throw new CliError('ATM_TEAM_HANDOFF_INTEGRITY_BLOCKED', `handoff-integrity-blocked: ${integrity.reason}.`, { exitCode: 1 });
  const directory = teamHandoffRuntimeDirectory(cwd, taskId, teamRunId);
  let sourceDirectory = directory;
  let sourceManifest = integrity.manifest;
  if (continuationFrom) {
    if (action !== 'context') throw new CliError('ATM_TEAM_HANDOFF_CONTINUATION_CONTEXT_ONLY', 'Continuation is only available through team handoff context.', { exitCode: 1 });
    const prior = verifyTeamHandoffHistory(cwd, taskId, continuationFrom);
    if (!prior.ok || prior.manifest.runOutcome === 'running') throw new CliError('ATM_TEAM_HANDOFF_CONTINUATION_BLOCKED', `handoff-integrity-blocked: terminal same-task continuation is required (${prior.reason ?? 'prior run is not terminal'}).`, { exitCode: 1 });
    sourceDirectory = teamHandoffHistoryDirectory(cwd, taskId, continuationFrom);
    sourceManifest = prior.manifest;
    appendTeamRuntimeObservabilityEvents(cwd, teamRunId, [createTeamObservabilityEvent({ eventType: 'handoff.consumed', taskId, teamRunId, providerId: 'unknown', role: 'coordinator', runtimeMode: 'broker-only', artifactType: 'atm.teamRoleHandoffArtifact.v1', artifactId: continuationFrom, decisionClass: 'auto-execution', decisionReason: 'same-task terminal continuation consumed through Coordinator context builder', violationStatus: 'none', statusCode: 'none', summary: `Continuation from terminal run ${continuationFrom} consumed.` })]);
  }
  const artifacts = readTeamHandoffArtifacts(sourceDirectory, sourceManifest);
  const bounded = artifacts.slice(-TEAM_HANDOFF_CONTEXT_MAX_ARTIFACTS).map((artifact) => ({ role: artifact.from.role, providerId: artifact.from.providerId, outputTextPreview: artifact.humanSummary }));
  const context = buildDirectTeamRoleInstructions({ taskId, role: 'consumer', priorRoleArtifacts: bounded });
  return makeResult({ ok: true, command: 'team', cwd, messages: [message('info', 'ATM_TEAM_HANDOFF_READY', `Team handoff ${action} is ready.`)], evidence: { action: `handoff.${action}`, taskId, teamRunId, continuationFrom: continuationFrom || null, permission, manifest: sourceManifest, artifacts: action === 'show' ? artifacts : undefined, context: action === 'context' ? context : undefined, stats: action === 'stats' ? { transitionCount: sourceManifest.transitionCount, contextTokens: context.telemetry.actualTokenCount } : undefined } });
}

function assertTeamHandoffHardGate(input: { cwd: string; taskId: string; teamRunId: string; actorId: string; permission: 'handoff.read' | 'handoff.materialize' }) {
  const definition = teamPermissionCatalog.find((entry) => entry.id === input.permission);
  const run = readTeamRun(input.cwd, input.teamRunId) as Record<string, unknown>;
  const runActorId = String(run.actorId ?? '').trim();
  const runTaskId = String(run.taskId ?? '').trim();
  const roles = Array.isArray(run.roles) ? run.roles : Array.isArray(run.agents) ? run.agents : [];
  const coordinator = roles.find((entry: any) => entry?.role === 'coordinator') as { agentId?: unknown; permissions?: unknown } | undefined;
  const coordinatorAgentId = String(coordinator?.agentId ?? '').trim();
  const coordinatorPermissions = Array.isArray(coordinator?.permissions) ? coordinator.permissions.map(String) : [];
  const leases = normalizePermissionLeaseRecords(run.permissionLeases ?? run.leases);
  const matchingLease = leases.find((lease) => lease.permission === input.permission && lease.agentId === coordinatorAgentId && Array.isArray(lease.paths) && lease.paths.length > 0);
  const hasCoordinator = Boolean(coordinatorAgentId);
  const authorizedActor = input.actorId === 'system' || (input.actorId === runActorId && hasCoordinator);
  if (!definition || definition.hardGate !== true || definition.scopeRequired !== true || runTaskId !== input.taskId || !authorizedActor || !coordinatorPermissions.includes(input.permission) || !matchingLease) {
    throw new CliError('ATM_TEAM_PERMISSION_HARD_GATE_BLOCKED', `handoff-integrity-blocked: ${input.permission} requires the bound Coordinator/system authority for this task and run.`, {
      exitCode: 1,
      details: { gateId: 'ATM_TEAM_PERMISSION_HARD_GATE', permission: input.permission, taskId: input.taskId, teamRunId: input.teamRunId, runTaskId, runActorId, coordinatorAgentId, hasCoordinator, coordinatorPermissionGranted: coordinatorPermissions.includes(input.permission), scopedLeaseGranted: Boolean(matchingLease) }
    });
  }
}
