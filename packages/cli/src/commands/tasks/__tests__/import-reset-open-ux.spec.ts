/**
 * TASK-RFT-0011 spec — tasks.import.resetOpenClassifier.
 *
 * Covers the four Strategy Map states of `classifyResetOpenImport`:
 *   - fresh-open
 *   - drift-with-active-claim
 *   - drift-without-claim
 *   - planning-in-progress-no-runtime
 *
 * Emergency gating must ONLY remain armed on `drift-with-active-claim`
 * (and the conservative `drift-without-claim` case). The normal
 * Phase 0 → Phase 1 handoff must NOT require an emergency lease anymore.
 */
import assert from 'node:assert/strict';
import { classifyResetOpenImport } from '../import-verify.ts';

// --- 1. fresh-open (no runtime ledger, no planning status) ---
const fresh = classifyResetOpenImport({
  planningStatus: null,
  runtimeLedgerStatus: null,
  runtimeActiveClaimActorId: null
});
assert.equal(fresh.state, 'fresh-open');
assert.equal(fresh.resetOpenEmergencyRequired, false, 'fresh-open must NOT require emergency lease');

// --- 2. planning-in-progress-no-runtime (the normal Phase 0 → Phase 1 handoff) ---
const handoff = classifyResetOpenImport({
  planningStatus: 'in-progress',
  runtimeLedgerStatus: null,
  runtimeActiveClaimActorId: null
});
assert.equal(handoff.state, 'planning-in-progress-no-runtime');
assert.equal(handoff.resetOpenEmergencyRequired, false, 'planning-in-progress-no-runtime must NOT require emergency lease');

// --- 2b. underscore + case variations still classify correctly ---
const handoffUnderscore = classifyResetOpenImport({
  planningStatus: 'IN_PROGRESS',
  runtimeLedgerStatus: null,
  runtimeActiveClaimActorId: null
});
assert.equal(handoffUnderscore.state, 'planning-in-progress-no-runtime');
assert.equal(handoffUnderscore.resetOpenEmergencyRequired, false);

// --- 3. drift-with-active-claim (real safety case: emergency STAYS on) ---
const activeClaim = classifyResetOpenImport({
  planningStatus: 'in-progress',
  runtimeLedgerStatus: 'in-progress',
  runtimeActiveClaimActorId: 'ClaudeCode_sonnet'
});
assert.equal(activeClaim.state, 'drift-with-active-claim');
assert.equal(activeClaim.resetOpenEmergencyRequired, true, 'active claim MUST still require emergency lease');

// --- 4. drift-without-claim (in-progress ledger but no active claim) ---
const drift = classifyResetOpenImport({
  planningStatus: 'in-progress',
  runtimeLedgerStatus: 'in-progress',
  runtimeActiveClaimActorId: null
});
assert.equal(drift.state, 'drift-without-claim');
assert.equal(drift.resetOpenEmergencyRequired, true, 'drift-without-claim keeps emergency gate');

// --- 5. inert ledger (closed) + no active claim → fresh-open safe path ---
const inert = classifyResetOpenImport({
  planningStatus: 'done',
  runtimeLedgerStatus: 'closed',
  runtimeActiveClaimActorId: null
});
assert.equal(inert.state, 'fresh-open');
assert.equal(inert.resetOpenEmergencyRequired, false);

// --- 6. Emergency-gate parity: only drift* states arm the gate ---
const states = [fresh, handoff, handoffUnderscore, activeClaim, drift, inert];
for (const s of states) {
  if (s.state.startsWith('drift')) {
    assert.equal(s.resetOpenEmergencyRequired, true, `state ${s.state} must gate emergency`);
  } else {
    assert.equal(s.resetOpenEmergencyRequired, false, `state ${s.state} must NOT gate emergency`);
  }
}

console.log('[import-reset-open-ux.spec] ok');
