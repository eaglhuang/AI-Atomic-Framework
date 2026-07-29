import { calculateBrokerDecision } from '../decision.js';
import { evaluateConflictMatrix } from '../conflict-matrix.js';
import { createHash } from 'node:crypto';
function canonicalArbitration(disposition) {
    if (disposition === 'direct' || disposition === 'proposal-required')
        return 'allow';
    if (disposition === 'compose' || disposition === 'queue')
        return 'watch';
    if (disposition === 'revalidate')
        return 'takeover';
    return 'freeze';
}
function ticketState(disposition) {
    if (disposition === 'direct')
        return 'execute-now';
    if (disposition === 'proposal-required')
        return 'proposal';
    if (disposition === 'true-conflict')
        return 'blocked';
    return disposition;
}
function actionFor(disposition) {
    if (disposition === 'direct')
        return 'execute';
    if (disposition === 'proposal-required')
        return 'submit-proposal';
    if (disposition === 'queue')
        return 'wait';
    if (disposition === 'true-conflict')
        return 'resolve-conflict';
    return disposition;
}
function selectDisposition(request, decision, policy) {
    if (decision.verdict === 'parallel-safe') {
        const proposalRequired = decision.admission?.requiresProposal === true
            || request.intent.proposalAdmission?.summarySubmitted === true;
        return proposalRequired && policy.preferProposalForBoundedWork !== false
            ? 'proposal-required'
            : 'direct';
    }
    if (decision.lane === 'deterministic-composer')
        return 'compose';
    if (decision.lane === 'neutral-steward')
        return 'compose';
    if (decision.lane === 'serial')
        return 'queue';
    if (decision.verdict === 'blocked-active-lease') {
        return decision.conflicts.some((conflict) => conflict.kind === 'file-range')
            ? 'true-conflict'
            : 'revalidate';
    }
    return 'true-conflict';
}
export function evaluateBrokerAdmission(request, registry, policy) {
    const authorized = policy.resolutionAuthorizedTaskIds ?? new Set();
    const effectiveRegistry = authorized.size === 0
        ? registry
        : {
            ...registry,
            activeIntents: registry.activeIntents.filter((intent) => !authorized.has(intent.taskId.trim().toUpperCase()))
        };
    const decision = calculateBrokerDecision(request.intent, effectiveRegistry);
    const disposition = selectDisposition(request, decision, policy);
    const conflictMatrix = decision.conflictMatrix ?? evaluateConflictMatrix(request.intent, effectiveRegistry.activeIntents, {
        currentEpoch: effectiveRegistry.currentEpoch
    });
    const arbitrationVerdict = canonicalArbitration(disposition);
    const gates = conflictMatrix.gateResults.map((gate) => {
        if (disposition === 'compose'
            && (gate.gate === 'atom-id' || gate.gate === 'atom-cid' || gate.gate === 'file-range')) {
            return {
                ...gate,
                status: 'watch',
                detail: `${gate.detail} Bounded proposal evidence refines this risk signal to compose routing.`
            };
        }
        if (disposition === 'true-conflict' && decision.conflicts.some((conflict) => conflict.kind === 'file-range')) {
            return gate.gate === 'file-range' ? { ...gate, status: 'block' } : gate;
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
        disposition,
        decision,
        decisionReason: decision.reason,
        ticket: {
            schemaId: 'atm.brokerTicket.v1',
            ticketId: `broker-admission-${ticketDigest}`,
            taskId: request.intent.taskId,
            state: ticketState(disposition)
        },
        trace: {
            schemaId: 'atm.brokerAdmissionTrace.v1',
            arbitrationVerdict,
            gates
        },
        commandManifests: [{
                schemaId: 'atm.commandManifest.v1',
                action: actionFor(disposition),
                argv: []
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
            manualInterventionCount: disposition === 'true-conflict' ? 1 : 0
        }
    };
}
