// TASK-MAO-0028: tests for the Team worker report ingestion contract.
import assert from 'node:assert/strict';
import { createWorkerReport, validateWorkerReport, effectiveExecutionState } from '../team-worker-report.js';
function testDoneReportPasses() {
    const r = createWorkerReport({
        taskId: 'T-A',
        workerActorId: 'worker-1',
        executionState: 'done',
        changedFiles: ['src/a.ts'],
        validatorRuns: [{ command: 'npm run typecheck', passed: true }]
    });
    assert.equal(validateWorkerReport(r).ok, true);
    assert.equal(effectiveExecutionState(r), 'done');
}
function testDoneWithFailingValidatorIsInconsistent() {
    const r = createWorkerReport({
        taskId: 'T-A',
        workerActorId: 'worker-1',
        executionState: 'done',
        changedFiles: ['src/a.ts'],
        validatorRuns: [{ command: 'npm run typecheck', passed: false, firstFailingDiagnostic: 'TS2322' }]
    });
    assert.equal(validateWorkerReport(r).ok, false);
    assert.equal(effectiveExecutionState(r), 'needs-review');
}
function testDoneWithNoChangedFilesFails() {
    const r = createWorkerReport({
        taskId: 'T-A',
        workerActorId: 'worker-1',
        executionState: 'done',
        changedFiles: [],
        validatorRuns: [{ command: 'npm run typecheck', passed: true }]
    });
    assert.equal(validateWorkerReport(r).ok, false);
}
function testFailingValidatorRequiresDiagnostic() {
    const r = createWorkerReport({
        taskId: 'T-A',
        workerActorId: 'worker-1',
        executionState: 'blocked',
        changedFiles: ['src/a.ts'],
        validatorRuns: [{ command: 'npm run typecheck', passed: false, firstFailingDiagnostic: null }]
    });
    assert.equal(validateWorkerReport(r).ok, false);
}
function testBlockedReportWithDiagnosticIsConsistent() {
    const r = createWorkerReport({
        taskId: 'T-A',
        workerActorId: 'worker-1',
        executionState: 'blocked',
        changedFiles: ['src/a.ts'],
        validatorRuns: [{ command: 'npm run typecheck', passed: false, firstFailingDiagnostic: 'TS2322 at a.ts:3' }],
        deviations: ['scope grew to include a.ts helper']
    });
    assert.equal(validateWorkerReport(r).ok, true);
    assert.equal(effectiveExecutionState(r), 'blocked');
}
testDoneReportPasses();
testDoneWithFailingValidatorIsInconsistent();
testDoneWithNoChangedFilesFails();
testFailingValidatorRequiresDiagnostic();
testBlockedReportWithDiagnosticIsConsistent();
console.log('team worker report tests: ok');
