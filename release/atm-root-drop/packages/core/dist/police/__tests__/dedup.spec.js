import assert from 'node:assert/strict';
import { runDedupPolice } from '../roles/dedup.js';
const positive = runDedupPolice({
    qualityComparisonReport: {
        dedupCandidates: [{ atomId: 'atom.dup', similarity: 0.95 }]
    }
});
assert.ok(positive.findings.some((f) => f.trigger === 'quality-dedup-candidate'), 'dup candidate must emit finding');
const negative = runDedupPolice({
    qualityComparisonReport: { dedupCandidates: [] }
});
assert.equal(negative.findings.length, 0, 'no candidates must emit no findings');
const threshold = runDedupPolice({
    qualityComparisonReport: {
        dedupCandidates: [{ atomId: 'atom.boundary', similarity: 0 }]
    }
});
assert.equal(threshold.findings.length, 1, 'zero-similarity candidate still surfaces as quality hint');
console.log('dedup.spec.ts: ok');
