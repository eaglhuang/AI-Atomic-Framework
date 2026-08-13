import assert from 'node:assert/strict';
import { compileRunbookCompletion, DEFAULT_PLANNING_ROOT } from '../../scripts/compile-runbook-completion-evidence.ts';
import { validateReport } from '../../scripts/validate-runbook-completion-evidence.ts';

const sha = 'a'.repeat(40);
assert.equal(DEFAULT_PLANNING_ROOT.endsWith('3KLife'), true);
// Use synthetic wave numbers so repository evidence cannot hydrate this isolated fixture.
const source = ['## Wave 98 — Preserve', '- [ ] first requirement', '退出條件：first exit', '## Wave 99 — Restore', '- [x] second requirement', '退出條件：second exit'].join('\n');
const report = compileRunbookCompletion(source, sha, sha, sha);
assert.equal(report.rows.length, 2);
assert.equal(report.waveExits.length, 2);
assert.equal(report.overallVerdict, 'not-complete');
assert.deepEqual(report.unresolvedIds, ['RB-001', 'RB-002', 'EXIT-01', 'EXIT-02']);
assert.deepEqual(report.unknownIds, []);
validateReport(report, source);

const forged = structuredClone(report);
forged.rows[0].status = 'proven';
assert.throws(() => validateReport(forged, source), /caller-authored green/);
const omitted = structuredClone(report);
omitted.rows.pop();
assert.throws(() => validateReport(omitted, source), /count drift/);
const falseGreen = structuredClone(report);
falseGreen.overallVerdict = 'complete';
assert.throws(() => validateReport(falseGreen, source), /complete verdict/);
console.log('[runbook-completion-evidence] ok');
