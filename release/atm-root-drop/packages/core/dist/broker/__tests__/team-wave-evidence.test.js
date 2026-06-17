// TASK-MAO-0029: tests for per-task wave evidence slicing.
import assert from 'node:assert/strict';
import { sliceWaveEvidence } from '../team-wave-evidence.js';
const members = [
    { taskId: 'T-A', scopePaths: ['src/a/'], deliverables: ['src/a/x.ts'] },
    { taskId: 'T-B', scopePaths: ['src/b/'], deliverables: ['src/b/y.ts'] }
];
function testCleanSliceIsDone() {
    const r = sliceWaveEvidence({ members, changedFiles: ['src/a/x.ts', 'src/b/y.ts'] });
    assert.equal(r.state, 'done');
    assert.deepEqual(r.slices.find((s) => s.taskId === 'T-A').attributedFiles, ['src/a/x.ts']);
    assert.deepEqual(r.slices.find((s) => s.taskId === 'T-B').attributedFiles, ['src/b/y.ts']);
}
function testUnattributedFileForcesNeedsReview() {
    const r = sliceWaveEvidence({ members, changedFiles: ['src/a/x.ts', 'src/c/z.ts'] });
    assert.equal(r.state, 'needs-review');
    assert.deepEqual(r.unattributed, ['src/c/z.ts']);
}
function testAmbiguousFileForcesNeedsReview() {
    const overlap = [
        { taskId: 'T-A', scopePaths: ['src/'], deliverables: [] },
        { taskId: 'T-B', scopePaths: ['src/'], deliverables: [] }
    ];
    const r = sliceWaveEvidence({ members: overlap, changedFiles: ['src/shared.ts'] });
    assert.equal(r.state, 'needs-review');
    assert.equal(r.ambiguous.length, 1);
    assert.deepEqual([...r.ambiguous[0].taskIds].sort(), ['T-A', 'T-B']);
}
function testAppendSafeFileAttributedToAllOwnersNotAmbiguous() {
    const overlap = [
        { taskId: 'T-A', scopePaths: ['src/a/', 'map.json'], deliverables: [] },
        { taskId: 'T-B', scopePaths: ['src/b/', 'map.json'], deliverables: [] }
    ];
    const r = sliceWaveEvidence({
        members: overlap,
        changedFiles: ['src/a/x.ts', 'src/b/y.ts', 'map.json'],
        appendSafePaths: ['map.json']
    });
    assert.equal(r.state, 'done');
    assert.ok(r.slices.find((s) => s.taskId === 'T-A').attributedFiles.includes('map.json'));
    assert.ok(r.slices.find((s) => s.taskId === 'T-B').attributedFiles.includes('map.json'));
    assert.equal(r.ambiguous.length, 0);
}
testCleanSliceIsDone();
testUnattributedFileForcesNeedsReview();
testAmbiguousFileForcesNeedsReview();
testAppendSafeFileAttributedToAllOwnersNotAmbiguous();
console.log('team wave evidence tests: ok');
