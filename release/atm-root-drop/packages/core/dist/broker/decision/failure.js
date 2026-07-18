import { buildBrokerDecisionFailureReason } from '../failure-reason.js';
export function withFailureReason(decision) {
    const failureReason = buildBrokerDecisionFailureReason(decision);
    return failureReason ? { ...decision, failureReason } : decision;
}
