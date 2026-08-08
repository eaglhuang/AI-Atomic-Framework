import assert from 'node:assert/strict';
import { reduceConcurrencySchedule } from '../../packages/core/src/evidence/concurrency-schedule-obligations.ts';
const result = reduceConcurrencySchedule({ scheduleId: 'fixture', authority: { authorityId: 'fixture-v1', sealed: false, digest: '' }, operations: [{ operationId: 'a', dependsOn: ['missing'] }, { operationId: 'b', dependsOn: ['a'] }, { operationId: 'a', dependsOn: ['b'] }] });
assert.equal(result.status, 'stale'); assert.ok(result.diagnostics.some((entry) => entry.code === 'ATM_SCHEDULE_AUTHORITY_UNSEALED')); console.log('plan4 concurrency schedule obligations negative: PASS');
