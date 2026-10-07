import { calculateBrokerDecision } from '../decision.ts';
import { evaluateConflictMatrix } from '../conflict-matrix.ts';
import { createHash } from 'node:crypto';
import { resolveSerialAdmission } from '../serial-queue/admission.ts';
import { isProposalReadinessUpgrade, ownsExactActiveSerialScope } from '../serial-queue/policy.ts';
import type {
  BrokerAdmissionDisposition,
  BrokerAdmissionPolicy,
  BrokerAdmissionRegistry,
  BrokerAdmissionRequest,
  BrokerAdmissionResult
} from './contracts.ts';

function canonicalArbitration(disposition: BrokerAdmissionDisposition): 'allow' | 'watch' | 'freeze' | 'takeover' {
  if (disposition === 'direct' || disposition === 'proposal-required') return 'allow';
  if (disposition === 'compose' || disposition === 'queue') return 'watch';
  if (disposition === 'revalidate') return 'takeover';
  return 'freeze';
}

function ticketState(disposition: BrokerAdmissionDisposition): BrokerAdmissionResult['ticket']['state'] {
  if (disposition === 'direct') return 'execute-now';
  if (disposition === 'proposal-required') return 'proposal';
  if (disposition === 'true-conflict') return 'blocked';
  return disposition;
}

function actionFor(disposition: BrokerAdmissionDisposition): BrokerAdmissionResult['commandManifests'][number]['action'] {
  if (disposition === 'direct') return 'execute';
  if (disposition === 'proposal-required') return 'submit-proposal';
  if (disposition === 'queue') return 'wait';
  if (disposition === 'true-conflict') return 'resolve-conflict';
  return disposition;
}

function selectDisposition(
  request: BrokerAdmissionRequest,
  decision: BrokerAdmissionResult['decision'],
  policy: BrokerAdmissionPolicy
): BrokerAdmissionDisposition {
  if (decision.verdict === 'parallel-safe') {
    const proposalRequired = decision.admission?.requiresProposal === true
      || request.intent.proposalAdmission?.summarySubmitted === true;
    return proposalRequired && policy.preferProposalForBoundedWork !== false
      ? 'proposal-required'
      : 'direct';
  }
  if (decision.lane === 'deterministic-composer') return 'compose';
  if (decision.lane === 'neutral-steward') return 'compose';
  if (decision.lane === 'serial') return 'queue';
  if (decision.verdict === 'blocked-active-lease') {
    return decision.conflicts.some((conflict) => conflict.kind === 'file-range')
      ? 'true-conflict'
      : 'revalidate';
  }
  return 'true-conflict';
}

export function evaluateBrokerAdmission(
  request: BrokerAdmissionRequest,
  registry: BrokerAdmissionRegistry,
  policy: BrokerAdmissionPolicy
): BrokerAdmissionResult {
  const authorized = policy.resolutionAuthorizedTaskIds ?? new Set<string>();
  const authorizedRegistry = authorized.size === 0
    ? registry
    : {
      ...registry,
      activeIntents: registry.activeIntents.filter((intent) => !authorized.has(intent.taskId.trim().toUpperCase()))
    };
  const serial = resolveSerialAdmission(request.intent, authorizedRegistry, policy.serialQueueResume, policy.nowMs ?? Date.now());
  const effectiveRegistry = serial.registry;
  const decision = calculateBrokerDecision(request.intent, effectiveRegistry, serial.revalidatedTicketId);
  const selected = selectDisposition(request, decision, policy);
  const holdingScopeChange = selected === 'queue' && effectiveRegistry.activeIntents.some((active) =>
    active.taskId === request.intent.taskId && active.actorId === request.intent.actorId && !ownsExactActiveSerialScope(request.intent, active));
  const proposalRegistrationChange = effectiveRegistry.activeIntents.some((active) => {
    if (active.taskId !== request.intent.taskId || active.actorId !== request.intent.actorId || !active.admission?.requiresProposal) return false;
    if (active.admission.state === 'proposal-submitted' && !active.admission.summarySubmitted) {
      const unchangedMetadata = request.intent.proposalAdmission?.summarySubmitted === false
        && active.baseCommit === request.intent.baseCommit && ownsExactActiveSerialScope(request.intent, active);
      return !unchangedMetadata && !isProposalReadinessUpgrade(request.intent, active, policy.nowMs ?? Date.now());
    }
    return active.admission.summarySubmitted && request.intent.proposalAdmission?.summarySubmitted !== true;
  });
  const replayWithoutLease = policy.requireLiveRegistration === true && !effectiveRegistry.activeIntents.some((active) =>
    ownsExactActiveSerialScope(request.intent, active) && active.baseCommit === request.intent.baseCommit
    && !!active.expiresAt && Date.parse(active.expiresAt) > (policy.nowMs ?? Date.now()));
  // Explicit queue revalidation never weakens active lease, read, or shared-surface guards.
  const disposition = holdingScopeChange || proposalRegistrationChange || replayWithoutLease ? 'revalidate'
    : selected === 'true-conflict' || selected === 'revalidate' ? selected : serial.disposition ?? selected;
  const conflictMatrix = decision.conflictMatrix ?? evaluateConflictMatrix(request.intent, effectiveRegistry.activeIntents, {
    currentEpoch: effectiveRegistry.currentEpoch
  });
  const arbitrationVerdict = canonicalArbitration(disposition);
  const gates = conflictMatrix.gateResults.map((gate) => {
    if (
      (disposition === 'compose' || disposition === 'queue')
      && (gate.gate === 'atom-id' || gate.gate === 'atom-cid' || gate.gate === 'file-range')
    ) {
      return {
        ...gate,
        status: 'watch' as const,
        detail: `${gate.detail} Canonical admission routes this risk to ${disposition}; no direct write is authorized.`
      };
    }
    if (disposition === 'true-conflict' && decision.conflicts.some((conflict) => conflict.kind === 'file-range')) {
      return gate.gate === 'file-range' ? { ...gate, status: 'block' as const } : gate;
    }
    return gate;
  });
  const ticketDigest = createHash('sha256')
    .update(JSON.stringify({
      taskId: request.intent.taskId,
      baseCommit: request.intent.baseCommit,
      disposition,
      targets: [...request.intent.targetFiles].sort()
    }))
    .digest('hex')
    .slice(0, 16);
  const startedAtMs = policy.startedAtMs ?? policy.nowMs ?? 0;
  const nowMs = policy.nowMs ?? startedAtMs;
  return {
    schemaId: 'atm.brokerAdmissionResult.v1',
    ...(serial.privateWork && serial.queue && (disposition === 'direct' || disposition === 'proposal-required')
      ? { privateWork: { queueTicketId: serial.queue.ticketId, allowedFiles: request.intent.targetFiles } } : {}),
    disposition,
    decision,
    decisionReason: replayWithoutLease ? 'The committed registration no longer has its exact live lease; replay does not acquire or renew authority.'
      : proposalRegistrationChange ? 'Proposal-only metadata can only become ready at the same live base and scope; downgrade or scope changes require release/revalidation.'
      : holdingScopeChange ? 'Finish and release the existing write lease before queuing a changed scope; holding it would deadlock earlier waiters.' : serial.reason ?? decision.reason,
    ticket: {
      schemaId: 'atm.brokerTicket.v1',
      ticketId: serial.queue?.ticketId ?? `broker-admission-${ticketDigest}`,
      taskId: request.intent.taskId,
      state: ticketState(disposition),
      ...(serial.queue ? { queue: serial.queue } : {})
    },
    trace: {
      schemaId: 'atm.brokerAdmissionTrace.v1',
      arbitrationVerdict,
      gates
    },
    commandManifests: [{
      schemaId: 'atm.commandManifest.v1',
      action: actionFor(disposition),
      argv: disposition === 'queue' || disposition === 'revalidate' ? ['broker', 'status', '--json'] : []
    }],
    evidenceRefs: policy.evidenceRefs ?? [],
    metrics: {
      schemaId: 'atm.brokerAdmissionMetrics.v1',
      decisionLatencyMs: Math.max(0, nowMs - startedAtMs),
      proposalRequests: disposition === 'proposal-required' ? 1 : 0,
      directAdmits: disposition === 'direct' ? 1 : 0,
      composeAdmits: disposition === 'compose' ? 1 : 0,
      trueConflicts: disposition === 'true-conflict' ? 1 : 0,
      queueDecisions: disposition === 'queue' ? 1 : 0,
      revalidateDecisions: disposition === 'revalidate' ? 1 : 0,
      manualInterventionCount: disposition === 'true-conflict' ? 1 : 0,
      ...(serial.queue ? { queueWaitMs: serial.queue.waitMs, queuePosition: serial.queue.position } : {})
    }
  };
}
