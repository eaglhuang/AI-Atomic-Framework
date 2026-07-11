import { assertEmergencyApproval } from '../gate.ts';
import { CliError } from '../../shared.ts';

function fail(message: string): never {
  console.error(`[emergency-gate.test] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

// ATM-BUG-2026-07-07-051: the first emergency approve attempt must already
// know which --allowed-flag entries the lease needs, because the blocked
// command already carries the protected flags.
try {
  assertEmergencyApproval({
    cwd: process.cwd(),
    surface: 'tasks close',
    permission: 'backend.tasks.close',
    taskId: 'TASK-EMG-TEST',
    actorId: 'validator',
    emergencyApproval: null,
    flags: ['--historical-delivery'],
    reason: 'validator regression',
    command: 'node atm.mjs tasks close --task TASK-EMG-TEST --historical-delivery deadbeef --json'
  });
  fail('assertEmergencyApproval must throw when no emergency approval lease is supplied');
} catch (error) {
  if (!(error instanceof CliError)) throw error;
  assert(error.code === 'ATM_EMERGENCY_LANE_APPROVAL_REQUIRED', 'must fail with the emergency lane approval code');
  const details = error.details as Record<string, unknown>;
  assert(Array.isArray(details.requiredAllowedFlags), 'error details must expose requiredAllowedFlags');
  assert((details.requiredAllowedFlags as string[]).includes('--historical-delivery'), 'requiredAllowedFlags must include the blocked command flag');
  const requiredCommand = String(details.requiredCommand ?? '');
  assert(requiredCommand.includes('--allowed-flag --historical-delivery'), 'requiredCommand must pre-approve the blocked flag so the first lease succeeds');
  assert(String(error.message).includes('ATM_EMERGENCY_FLAG_NOT_APPROVED'), 'error message must warn that a missing --allowed-flag will fail the lease');
}

// No protected flags: requiredCommand must stay flag-free (backward compatible with existing fixtures).
try {
  assertEmergencyApproval({
    cwd: process.cwd(),
    surface: 'tasks reconcile',
    permission: 'backend.tasks.reconcile',
    taskId: 'TASK-EMG-TEST-2',
    actorId: 'validator',
    emergencyApproval: null,
    flags: [],
    reason: 'validator regression',
    command: 'node atm.mjs tasks reconcile --task TASK-EMG-TEST-2 --json'
  });
  fail('assertEmergencyApproval must throw when no emergency approval lease is supplied');
} catch (error) {
  if (!(error instanceof CliError)) throw error;
  const details = error.details as Record<string, unknown>;
  assert(Array.isArray(details.requiredAllowedFlags) && (details.requiredAllowedFlags as string[]).length === 0, 'requiredAllowedFlags must stay empty when no protected flags are in play');
  assert(!String(details.requiredCommand ?? '').includes('--allowed-flag'), 'requiredCommand must not add --allowed-flag when no protected flags are used');
}

console.log('[emergency-gate.test] ok');
