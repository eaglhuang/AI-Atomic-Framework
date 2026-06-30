/**
 * TASK-RFT-0010 spec — tasks.close.governance.
 *
 * Covers allowed / blocked / recoverable close outcomes.
 */
import {
  classifyTaskCloseBlockerCode,
  computeTaskCloseAuthority,
  evaluateClosurePacketTrust
} from '../close-governance.ts';

function fail(message: string): never {
  console.error(`[close-governance.spec] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

// --- close authority ---
const ownerMatch = computeTaskCloseAuthority({ currentOwner: 'agent-A', actorId: 'agent-A' });
assert(ownerMatch.allowed && ownerMatch.reason === 'owner-match', 'owner-match should allow close');

const noOwner = computeTaskCloseAuthority({ currentOwner: null, actorId: 'agent-A' });
assert(noOwner.allowed && noOwner.reason === 'no-current-owner', 'absent owner should allow first close');

const mismatch = computeTaskCloseAuthority({ currentOwner: 'agent-A', actorId: 'agent-B' });
assert(!mismatch.allowed && mismatch.reason === 'owner-mismatch', 'foreign actor should be blocked');

const missingActor = computeTaskCloseAuthority({ currentOwner: 'agent-A', actorId: null });
assert(!missingActor.allowed && missingActor.reason === 'missing-actor', 'missing actor should be blocked');

// --- closure packet trust ---
const trusted = evaluateClosurePacketTrust({
  packetPresent: true,
  packetValid: true,
  packetSchemaIdMatches: true,
  repairAvailable: false
});
assert(trusted.trusted && trusted.verdict === 'trusted', 'valid packet should be trusted');

const recoverable = evaluateClosurePacketTrust({
  packetPresent: true,
  packetValid: false,
  packetSchemaIdMatches: true,
  repairAvailable: true
});
assert(!recoverable.trusted && recoverable.verdict === 'recoverable-repair', 'invalid-but-repairable packet should route to repair');

const rejectedInvalid = evaluateClosurePacketTrust({
  packetPresent: true,
  packetValid: false,
  packetSchemaIdMatches: true,
  repairAvailable: false
});
assert(!rejectedInvalid.trusted && rejectedInvalid.verdict === 'rejected-invalid', 'invalid packet without repair should be rejected');

const rejectedMissing = evaluateClosurePacketTrust({
  packetPresent: false,
  packetValid: false,
  packetSchemaIdMatches: false,
  repairAvailable: true
});
assert(!rejectedMissing.trusted && rejectedMissing.verdict === 'rejected-missing', 'missing packet should be rejected');

const schemaMismatch = evaluateClosurePacketTrust({
  packetPresent: true,
  packetValid: true,
  packetSchemaIdMatches: false,
  repairAvailable: true
});
assert(!schemaMismatch.trusted && schemaMismatch.verdict === 'rejected-schema-mismatch', 'schema mismatch should be rejected');

// --- blocker-code classification (allowed/blocked/recoverable) ---
const usage = classifyTaskCloseBlockerCode('ATM_CLI_USAGE');
assert(usage.blockerClass === 'usage' && !usage.recoverable, 'usage errors are non-recoverable');

const identity = classifyTaskCloseBlockerCode('ATM_ACTOR_ID_MISSING');
assert(identity.blockerClass === 'identity' && !identity.recoverable, 'missing actor is non-recoverable');

const authority = classifyTaskCloseBlockerCode('ATM_TASK_CLOSE_OWNER_MISMATCH');
assert(authority.blockerClass === 'authority' && !authority.recoverable, 'owner mismatch is non-recoverable');

const packetRepair = classifyTaskCloseBlockerCode('ATM_TASK_CLOSURE_PACKET_INVALID');
assert(packetRepair.blockerClass === 'closure-packet' && packetRepair.recoverable, 'closure packet failures are recoverable via repair');

const runnerStale = classifyTaskCloseBlockerCode('ATM_TASK_CLOSE_RUNNER_STALE');
assert(runnerStale.blockerClass === 'runner-stale' && runnerStale.recoverable, 'stale runner is recoverable via override audit');

const emergency = classifyTaskCloseBlockerCode('ATM_EMERGENCY_PROTECTED_OVERRIDE_DENIED');
assert(emergency.blockerClass === 'emergency-protected' && !emergency.recoverable, 'emergency-protected denial is not silently recoverable');

const dependency = classifyTaskCloseBlockerCode('ATM_TASK_DEPENDENCY_BLOCKED');
assert(dependency.blockerClass === 'dependency-gate' && !dependency.recoverable, 'dependency-gate failures are not silently recoverable');

const lifecycle = classifyTaskCloseBlockerCode('ATM_TASK_NOT_FOUND');
assert(lifecycle.blockerClass === 'lifecycle' && !lifecycle.recoverable, 'task-not-found is non-recoverable');

const unknown = classifyTaskCloseBlockerCode('ATM_TOTALLY_NEW_CODE');
assert(unknown.blockerClass === 'unknown' && !unknown.recoverable, 'unknown codes are not auto-recoverable');

console.log('[close-governance.spec] ok');
