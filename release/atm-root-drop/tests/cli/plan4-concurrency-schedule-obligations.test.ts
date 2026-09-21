import assert from 'node:assert/strict';
import { reduceConcurrencySchedule, replayConcurrencySchedule, validateConcurrencyScheduleResult } from '../../packages/core/src/evidence/concurrency-schedule-obligations.ts';
const input = { scheduleId: 'fixture', authority: { authorityId: 'fixture-v1', sealed: true, digest: 'sha256:fixture' }, operations: [{ operationId: 'write-a', writes: ['a'] }, { operationId: 'read-a', reads: ['a'] }, { operationId: 'write-b', writes: ['b'] }] };
const result = reduceConcurrencySchedule(input);
assert.equal(result.status, 'reduced'); assert.equal(result.reducedSchedule.length, 3); assert.equal(validateConcurrencyScheduleResult(result).ok, true); assert.equal(replayConcurrencySchedule(input, result).deterministic, true); assert.ok(result.obligations.length >= 1); console.log('plan4 concurrency schedule obligations: PASS');
