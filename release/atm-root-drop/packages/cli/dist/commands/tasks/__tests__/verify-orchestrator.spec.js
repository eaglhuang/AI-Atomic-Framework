/**
 * TASK-RFT-0012 spec — verify-orchestrator surface smoke test.
 *
 * The verify orchestrator is the least destructive of the three (read-only
 * scan of the task store). We test:
 *   - pass: a non-existent store returns a warning-level report ok=true
 *   - fail: a store containing an invalid JSON file yields ok=false
 *   - diagnostic-sort: findings preserve insertion order (invalid JSON first,
 *     then dependency-missing warning)
 */
import path from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runTasksVerify } from '../verify-orchestrator.js';
function fail(message) {
    console.error(`[verify-orchestrator.spec] ${message}`);
    process.exitCode = 1;
    throw new Error(message);
}
function assert(condition, message) {
    if (!condition)
        fail(message);
}
assert(typeof runTasksVerify === 'function', 'runTasksVerify export must be a function');
assert(runTasksVerify.constructor.name === 'AsyncFunction', 'runTasksVerify must be async');
// -- pass: missing store returns ok=true with warning --
const passCwd = mkdtempSync(path.join(tmpdir(), 'rft12-verify-pass-'));
try {
    const result = await runTasksVerify(['--cwd', passCwd]);
    assert(result.ok === true, 'pass: expected ok=true when task store is missing');
    const report = result.evidence?.report;
    assert(Array.isArray(report?.findings), 'pass: expected findings array on report');
    const warned = report.findings.some((f) => f.code === 'ATM_TASKS_VERIFY_STORE_MISSING');
    assert(warned, 'pass: expected ATM_TASKS_VERIFY_STORE_MISSING warning');
}
finally {
    rmSync(passCwd, { recursive: true, force: true });
}
// -- fail: invalid json file yields ok=false --
const failCwd = mkdtempSync(path.join(tmpdir(), 'rft12-verify-fail-'));
try {
    mkdirSync(path.join(failCwd, '.atm', 'history', 'tasks'), { recursive: true });
    writeFileSync(path.join(failCwd, '.atm', 'history', 'tasks', 'TASK-X.json'), '{not json');
    const result = await runTasksVerify(['--cwd', failCwd]);
    assert(result.ok === false, 'fail: expected ok=false for invalid JSON');
    const report = result.evidence.report;
    const hasInvalid = report.findings.some((f) => f.code === 'ATM_TASKS_VERIFY_INVALID_JSON');
    assert(hasInvalid, 'fail: expected ATM_TASKS_VERIFY_INVALID_JSON finding');
}
finally {
    rmSync(failCwd, { recursive: true, force: true });
}
// -- diagnostic-sort: entries are read in sorted filename order --
const sortCwd = mkdtempSync(path.join(tmpdir(), 'rft12-verify-sort-'));
try {
    mkdirSync(path.join(sortCwd, '.atm', 'history', 'tasks'), { recursive: true });
    writeFileSync(path.join(sortCwd, '.atm', 'history', 'tasks', 'TASK-B.json'), '{not json');
    writeFileSync(path.join(sortCwd, '.atm', 'history', 'tasks', 'TASK-A.json'), JSON.stringify({
        workItemId: 'TASK-A',
        status: 'open',
        dependencies: ['TASK-MISSING']
    }));
    const result = await runTasksVerify(['--cwd', sortCwd]);
    const report = result.evidence.report;
    // TASK-A read first (sorted), so dep-missing warning appears before the parse error's file order.
    const codes = report.findings.map((f) => f.code);
    const invalidIdx = codes.indexOf('ATM_TASKS_VERIFY_INVALID_JSON');
    const depIdx = codes.indexOf('ATM_TASKS_VERIFY_DEPENDENCY_MISSING');
    assert(invalidIdx >= 0, 'diagnostic-sort: expected invalid-json finding');
    assert(depIdx >= 0, 'diagnostic-sort: expected dependency-missing finding');
    // TASK-A processed before TASK-B, but dep-missing check runs in a second pass after per-file
    // findings, so invalid-json appears before dependency-missing in the emitted list.
    assert(invalidIdx < depIdx, 'diagnostic-sort: per-file findings must precede second-pass findings');
}
finally {
    rmSync(sortCwd, { recursive: true, force: true });
}
console.log('[verify-orchestrator.spec] ok (3 branches)');
