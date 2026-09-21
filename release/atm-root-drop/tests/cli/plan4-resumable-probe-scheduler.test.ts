/**
 * ATM-GOV-0285 — resumable probe scheduler.
 *
 * Case id: test_atm_gov_0285_resumable_probe_cursor_91d4c7e2
 *
 * Red predicate: a resumed probe duplicates completed work, skips pending work,
 * or passes without unavailable-data evidence.
 */

import { strict as assert } from 'node:assert';
import {
  ATM_PROBE_DATA_UNAVAILABLE,
  RESUMABLE_PROBE_SCHEDULE_SCHEMA_ID,
  planResumableProbeSchedule,
  resumeProbeSchedule,
  selectValidatorCatalogEntries,
  type CatalogCaseEntry
} from '../../packages/core/src/evidence/validator-catalog-selection.ts';

const catalog: readonly CatalogCaseEntry[] = ['alpha', 'beta', 'gamma'].map((name) => ({
  caseId: `test_${name}_case`,
  groupId: `test_group_${name}`,
  command: `node --strip-types tests/cli/${name}.test.ts`,
  responsibility: 'task-required',
  supportedSeams: [],
  coversImpactEdges: [],
  coversAcceptance: []
}));

const selection = selectValidatorCatalogEntries({
  catalog,
  request: {
    taskId: 'ATM-GOV-FIXTURE',
    requiredTestCaseIds: catalog.map((entry) => entry.caseId),
    validatorRefs: [],
    changedPublicSeams: [],
    causalImpactEdges: []
  }
});

// --- fresh execution: everything is pending, nothing is assumed ----------

const fresh = planResumableProbeSchedule({ selection, scheduleId: 'schedule-fixture' });
assert.equal(fresh.schemaId, RESUMABLE_PROBE_SCHEDULE_SCHEMA_ID);
assert.equal(fresh.taskId, 'ATM-GOV-FIXTURE');
assert.deepEqual(fresh.probes.map((probe) => probe.status), ['pending', 'pending', 'pending']);
assert.equal(fresh.cursor.nextProbeId, fresh.probes[0]!.probeId);
assert.deepEqual(fresh.cursor, {
  nextProbeId: fresh.probes[0]!.probeId,
  completed: 0,
  pending: 3,
  unavailable: 0,
  failed: 0
});
assert.equal(fresh.verdict, 'incomplete');
assert.equal(fresh.terminal, false);
assert.deepEqual(fresh.evidenceRequests, []);
assert.equal(
  planResumableProbeSchedule({ selection, scheduleId: 'schedule-fixture' }).scheduleDigest,
  fresh.scheduleDigest,
  'planning the same selection twice must be stable'
);

// --- resume: completed work is not repeated, pending work is not lost ----

const afterFirst = resumeProbeSchedule({
  schedule: fresh,
  observations: [{ probeId: fresh.probes[0]!.probeId, status: 'completed' }]
});
assert.deepEqual(afterFirst.probes.map((probe) => probe.status), ['completed', 'pending', 'pending']);
assert.equal(afterFirst.cursor.nextProbeId, fresh.probes[1]!.probeId, 'the cursor must advance to the next pending probe');
assert.equal(afterFirst.cursor.completed, 1);
assert.equal(afterFirst.cursor.pending, 2);
assert.equal(afterFirst.probes[0]!.attempts, 1);

// Re-delivering the same observation is idempotent: no second attempt, no
// duplicate probe, and the cursor does not move backwards.
const replayed = resumeProbeSchedule({
  schedule: afterFirst,
  observations: [{ probeId: fresh.probes[0]!.probeId, status: 'completed' }]
});
assert.equal(replayed.probes[0]!.attempts, 1, 'a completed probe must not be run again on resume');
assert.equal(replayed.scheduleDigest, afterFirst.scheduleDigest, 'a duplicate observation must not change the schedule');
assert.deepEqual(replayed.duplicateObservationIds, [fresh.probes[0]!.probeId]);
assert.equal(replayed.probes.length, 3, 'resume must not duplicate probes');

// An observation for a probe this schedule never planned is rejected, not adopted.
const foreign = resumeProbeSchedule({
  schedule: afterFirst,
  observations: [{ probeId: 'probe-never-planned', status: 'completed' }]
});
assert.deepEqual(foreign.unknownObservationIds, ['probe-never-planned']);
assert.equal(foreign.probes.length, 3);
assert.equal(foreign.scheduleDigest, afterFirst.scheduleDigest);

// --- unavailable data fails closed with an evidence request (ACC-3) -----

const unavailable = resumeProbeSchedule({
  schedule: afterFirst,
  observations: [{ probeId: fresh.probes[1]!.probeId, status: 'unavailable', detail: 'validator host offline' }]
});
assert.equal(unavailable.probes[1]!.status, 'unavailable');
assert.equal(unavailable.cursor.unavailable, 1);
assert.equal(unavailable.evidenceRequests.length, 1);
assert.equal(unavailable.evidenceRequests[0]!.code, ATM_PROBE_DATA_UNAVAILABLE);
assert.equal(unavailable.evidenceRequests[0]!.probeId, fresh.probes[1]!.probeId);
assert.equal(
  unavailable.evidenceRequests[0]!.requiredCommand,
  'node atm.mjs evidence run --task ATM-GOV-FIXTURE --actor <id> --command "node --strip-types tests/cli/beta.test.ts" --json'
);
assert.equal(unavailable.verdict, 'incomplete', 'unavailable probe data must never read as complete');

// Completing the rest still cannot claim completeness while data is missing.
const stillIncomplete = resumeProbeSchedule({
  schedule: unavailable,
  observations: [{ probeId: fresh.probes[2]!.probeId, status: 'completed' }]
});
assert.equal(stillIncomplete.cursor.pending, 0);
assert.equal(stillIncomplete.verdict, 'incomplete');
assert.equal(stillIncomplete.terminal, false, 'an unresolved probe keeps the schedule resumable');
assert.equal(stillIncomplete.cursor.nextProbeId, fresh.probes[1]!.probeId, 'the cursor points at the work still owed');

// Re-observing the unavailable probe as completed resolves it.
const resolved = resumeProbeSchedule({
  schedule: stillIncomplete,
  observations: [{ probeId: fresh.probes[1]!.probeId, status: 'completed' }]
});
assert.equal(resolved.verdict, 'complete');
assert.equal(resolved.terminal, true);
assert.deepEqual(resolved.evidenceRequests, []);
assert.equal(resolved.cursor.nextProbeId, null);
assert.equal(resolved.probes[1]!.attempts, 2, 'a retried probe records both attempts');

// --- a failed probe blocks rather than silently completing --------------

const failed = resumeProbeSchedule({
  schedule: resolved,
  observations: [{ probeId: fresh.probes[2]!.probeId, status: 'failed', detail: 'assertion failed' }]
});
assert.equal(failed.verdict, 'blocked');
assert.equal(failed.terminal, true);
assert.equal(failed.cursor.failed, 1);
assert.equal(failed.probes[2]!.detail, 'assertion failed');
assert.equal(failed.evidenceRequests.length, 0, 'a failure is a result, not missing data');

// --- resume is a pure function of schedule plus observations ------------

const replayedFromScratch = [
  { probeId: fresh.probes[0]!.probeId, status: 'completed' as const },
  { probeId: fresh.probes[1]!.probeId, status: 'unavailable' as const, detail: 'validator host offline' },
  { probeId: fresh.probes[2]!.probeId, status: 'completed' as const },
  { probeId: fresh.probes[1]!.probeId, status: 'completed' as const }
].reduce((schedule, observation) => resumeProbeSchedule({ schedule, observations: [observation] }), fresh);
assert.equal(replayedFromScratch.scheduleDigest, resolved.scheduleDigest, 'replaying the observation stream rebuilds the same schedule');

console.log(JSON.stringify({
  marker: '[plan4-resumable-probe-scheduler:test] ok',
  caseId: 'test_atm_gov_0285_resumable_probe_cursor_91d4c7e2',
  scheduleDigest: resolved.scheduleDigest,
  verdicts: [fresh.verdict, unavailable.verdict, resolved.verdict, failed.verdict]
}));
