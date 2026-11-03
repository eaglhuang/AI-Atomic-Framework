import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveFrameworkTempPublicationCapability } from '../framework-development/framework-temp-publication-capability.ts';
import { CliError, makeResult, message } from '../shared.ts';

/** Renew the exact live holder/lane without replacing scope, lease, or linked task. */
export function renewFrameworkTempClaim(input: {
  cwd: string; taskId: string; actorId: string; ttlSeconds: number;
}) {
  const laneSessionId = process.env.ATM_LANE_SESSION_ID?.trim() || null;
  const capability = resolveFrameworkTempPublicationCapability({ ...input, laneSessionId });
  if (!capability || capability.taskId !== input.taskId || capability.laneSessionId !== laneSessionId || !Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds <= 0) {
    throw new CliError('ATM_FRAMEWORK_TEMP_RENEW_DENIED', 'Renew requires the exact live temporary framework claim owned by this actor and lane; expired claims require framework-mode claim.', { exitCode: 1 });
  }
  const lockPath = path.join(input.cwd, '.atm/runtime/locks', `${capability.taskId}.lock.json`);
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
  const heartbeatAt = new Date().toISOString();
  const claim = { ...lock, heartbeatAt, ttlSeconds: input.ttlSeconds };
  const receipt = { schemaId: 'atm.frameworkTempClaimRenewal.v1', taskId: capability.taskId,
    actorId: input.actorId, laneSessionId: capability.laneSessionId, leaseId: lock.leaseId,
    previousHeartbeatAt: capability.heartbeatAt, heartbeatAt, ttlSeconds: input.ttlSeconds,
    expiresAt: new Date(Date.parse(heartbeatAt) + input.ttlSeconds * 1000).toISOString() };
  writeFileSync(lockPath, `${JSON.stringify(claim, null, 2)}\n`, 'utf8');
  return makeResult({ ok: true, command: 'tasks', cwd: input.cwd,
    messages: [message('info', 'ATM_FRAMEWORK_TEMP_CLAIM_RENEWED', 'Temporary framework claim renewed; renew before validation/build/commit when more lease time is needed.', receipt)],
    evidence: { action: 'renew', taskId: capability.taskId, actorId: input.actorId, claim, receipt } });
}
