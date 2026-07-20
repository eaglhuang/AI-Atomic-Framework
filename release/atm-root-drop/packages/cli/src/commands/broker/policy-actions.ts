// @ts-nocheck
import { CliError, makeResult, message } from '../shared.ts';
import {
  buildParallelAdmissionReceipt,
  readParallelAdmissionPolicy,
  resetParallelAdmissionPolicy,
  tripParallelAdmissionPolicy,
  updateParallelAdmissionPolicy
} from '../../../../core/src/broker/parallel-admission-policy.ts';
import type { BrokerCommandContext } from './types.ts';
import type { ParsedBrokerOptions } from './parser.ts';

export function handleBrokerParallelAdmissionPolicy(options: ParsedBrokerOptions, _context: BrokerCommandContext) {
  if (options.action !== 'parallel-admission') return null;
  const action = options.parallelAdmissionAction;
  if (!action) {
    throw new CliError('ATM_CLI_USAGE', 'broker parallel-admission requires an action: status | set | trip | reset.', { exitCode: 2 });
  }

  if (action === 'status') {
    const policy = readParallelAdmissionPolicy(options.cwd);
    return buildPolicyResult(options, 'status', policy, 'ATM_PARALLEL_ADMISSION_POLICY_STATUS', 'Loaded parallel admission policy.');
  }

  if (action === 'set') {
    const patch: Record<string, unknown> = {};
    if (options.policyMode) patch.mode = options.policyMode;
    if (options.policyFallbackMode) patch.fallbackMode = options.policyFallbackMode;
    if (options.policyCircuitBreaker !== null) patch.circuitBreakerEnabled = options.policyCircuitBreaker;
    if (options.scopeFiles.length > 0) patch.rolloutScope = options.scopeFiles;
    const policy = updateParallelAdmissionPolicy(options.cwd, patch);
    return buildPolicyResult(options, 'set', policy, 'ATM_PARALLEL_ADMISSION_POLICY_SET', 'Updated parallel admission policy.');
  }

  if (action === 'trip') {
    if (!options.actorId) {
      throw new CliError('ATM_CLI_USAGE', 'broker parallel-admission trip requires --actor <actor-id>.', { exitCode: 2 });
    }
    if (!options.reason) {
      throw new CliError('ATM_CLI_USAGE', 'broker parallel-admission trip requires --reason <text>.', { exitCode: 2 });
    }
    const policy = tripParallelAdmissionPolicy(options.cwd, { actorId: options.actorId, reason: options.reason });
    return buildPolicyResult(options, 'trip', policy, 'ATM_PARALLEL_ADMISSION_POLICY_TRIPPED', 'Tripped parallel admission policy circuit breaker.');
  }

  if (action === 'reset') {
    if (!options.actorId) {
      throw new CliError('ATM_CLI_USAGE', 'broker parallel-admission reset requires --actor <actor-id>.', { exitCode: 2 });
    }
    if (!options.receiptDigest || !/^sha256:[a-f0-9]{64}$/i.test(options.receiptDigest)) {
      throw new CliError('ATM_CLI_USAGE', 'broker parallel-admission reset requires --receipt-digest sha256:<64-hex>.', { exitCode: 2 });
    }
    const policy = resetParallelAdmissionPolicy(options.cwd, { actorId: options.actorId, receiptDigest: options.receiptDigest });
    return buildPolicyResult(options, 'reset', policy, 'ATM_PARALLEL_ADMISSION_POLICY_RESET', 'Reset parallel admission policy circuit breaker.');
  }

  throw new CliError('ATM_CLI_USAGE', 'broker parallel-admission supports: status, set, trip, reset.', { exitCode: 2 });
}

function buildPolicyResult(options: ParsedBrokerOptions, action, policy, code: string, text: string) {
  const receipt = buildParallelAdmissionReceipt({ cwd: options.cwd, action, actorId: options.actorId, policy });
  return makeResult({
    ok: true,
    command: 'broker',
    cwd: options.cwd,
    messages: [message('info', code, text, { action, mode: policy.mode, fallbackMode: policy.fallbackMode, tripped: policy.tripped })],
    evidence: {
      action: `parallel-admission-${action}`,
      receipt,
      policy,
      gateMatrix: policy.gatePolicies
    }
  });
}
