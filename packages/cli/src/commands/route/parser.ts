import path from 'node:path';
import type { RouteClaimIntent } from '../../../../core/src/routing/index.ts';
import { CliError } from '../shared.ts';
import { lifecycleActions, type RouteAction, type RouteLifecycleAction, type RouteOptions } from './types.ts';

export function parseRouteArgs(argv: string[]) {
  const state = {
    cwd: process.cwd(),
    action: null as RouteAction | null,
    routeId: null as string | null,
    taskId: null as string | null,
    actorId: null as string | null,
    claimIntent: 'write' as RouteClaimIntent,
    leaseId: null as string | null,
    ttlSeconds: 1800,
    maxSeconds: 7200,
    readSet: [] as string[],
    writeSet: [] as string[],
    targetAtomCids: [] as string[],
    targetVirtualAtomCids: [] as string[],
    patchEnvelopeRef: null as string | null,
    reason: null as string | null,
    admissionRechecked: false,
    mergePlanFile: null as string | null,
    proposalFile: null as string | null,
    stewardId: null as string | null,
    evidenceOutPath: null as string | null,
    scopeFiles: [] as string[]
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      state.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--route' || arg === '--route-id') {
      state.routeId = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--task') {
      state.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      state.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--claim-intent') {
      state.claimIntent = parseClaimIntent(requireValue(argv, index, '--claim-intent'));
      index += 1;
      continue;
    }
    if (arg === '--lease-id') {
      state.leaseId = requireValue(argv, index, '--lease-id');
      index += 1;
      continue;
    }
    if (arg === '--ttl-seconds') {
      state.ttlSeconds = parsePositiveInteger(requireValue(argv, index, '--ttl-seconds'), '--ttl-seconds');
      index += 1;
      continue;
    }
    if (arg === '--max-seconds') {
      state.maxSeconds = parsePositiveInteger(requireValue(argv, index, '--max-seconds'), '--max-seconds');
      index += 1;
      continue;
    }
    if (arg === '--read-set') {
      state.readSet = parseCsv(requireValue(argv, index, '--read-set'));
      index += 1;
      continue;
    }
    if (arg === '--write-set') {
      state.writeSet = parseCsv(requireValue(argv, index, '--write-set'));
      index += 1;
      continue;
    }
    if (arg === '--atom-cids') {
      state.targetAtomCids = parseCsv(requireValue(argv, index, '--atom-cids'));
      index += 1;
      continue;
    }
    if (arg === '--virtual-atom-cids') {
      state.targetVirtualAtomCids = parseCsv(requireValue(argv, index, '--virtual-atom-cids'));
      index += 1;
      continue;
    }
    if (arg === '--patch-envelope-ref') {
      state.patchEnvelopeRef = requireValue(argv, index, '--patch-envelope-ref');
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      state.reason = requireValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--admission-rechecked') {
      state.admissionRechecked = true;
      continue;
    }
    if (arg === '--merge-plan-file') {
      state.mergePlanFile = requireValue(argv, index, '--merge-plan-file');
      index += 1;
      continue;
    }
    if (arg === '--proposal-file') {
      state.proposalFile = requireValue(argv, index, '--proposal-file');
      index += 1;
      continue;
    }
    if (arg === '--steward-id') {
      state.stewardId = requireValue(argv, index, '--steward-id');
      index += 1;
      continue;
    }
    if (arg === '--evidence-out-path') {
      state.evidenceOutPath = requireValue(argv, index, '--evidence-out-path');
      index += 1;
      continue;
    }
    if (arg === '--scope-files') {
      state.scopeFiles = parseCsv(requireValue(argv, index, '--scope-files'));
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `route does not support option ${arg}`, { exitCode: 2 });
    }
    if (state.action) {
      throw new CliError('ATM_CLI_USAGE', 'route accepts only one action', { exitCode: 2 });
    }
    state.action = parseAction(arg);
  }

  if (!state.action) {
    throw new CliError('ATM_CLI_USAGE', 'route requires an action: open, status, list, pause, resume, abandon, handoff, or takeover.', { exitCode: 2 });
  }

  return {
    ...state,
    cwd: path.resolve(state.cwd),
    action: state.action
  };
}

function parseAction(value: string): RouteAction {
  if (value === 'takeover' || lifecycleActions.has(value as RouteLifecycleAction)) {
    return value as RouteAction;
  }
  throw new CliError('ATM_CLI_USAGE', 'route supports open, status, list, pause, resume, abandon, handoff, and takeover.', { exitCode: 2 });
}

function parseClaimIntent(value: string): RouteClaimIntent {
  if (value === 'read' || value === 'write' || value === 'review' || value === 'steward' || value === 'release-sync') {
    return value;
  }
  throw new CliError('ATM_CLI_USAGE', `unsupported route claim intent: ${value}`, { exitCode: 2 });
}

function parsePositiveInteger(value: string, optionName: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliError('ATM_CLI_USAGE', `${optionName} must be a positive integer.`, { exitCode: 2 });
  }
  return parsed;
}

function parseCsv(value: string) {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function requireValue(argv: string[], optionIndex: number, optionName: string): string {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `route requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}
