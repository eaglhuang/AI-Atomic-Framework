import type { BrokerDecision } from '../types.ts';
import { buildBrokerDecisionFailureReason } from '../failure-reason.ts';

export function withFailureReason(decision: BrokerDecision): BrokerDecision {
  const failureReason = buildBrokerDecisionFailureReason(decision);
  return failureReason ? { ...decision, failureReason } : decision;
}
