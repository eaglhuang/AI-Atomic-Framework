import assert from 'node:assert/strict';
import { runQualityPolice } from '../roles/quality.js';
const baseline = runQualityPolice({
    qualityComparisonReport: {
        reportId: 'q-1',
        atomId: 'atom.ok',
        fromVersion: '1.0.0',
        toVersion: '1.0.1',
        regressedMetrics: [],
        mapImpactScope: { propagationStatus: [] },
        dedupCandidates: []
    }
});
assert.equal(baseline.status, 'pass');
assert.equal(baseline.findings.length, 0);
const regression = runQualityPolice({
    qualityComparisonReport: {
        reportId: 'q-2',
        atomId: 'atom.reg',
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        regressedMetrics: ['latency'],
        mapImpactScope: { propagationStatus: [] },
        dedupCandidates: []
    }
});
assert.equal(regression.status, 'fail');
assert.ok(regression.findings.some((f) => f.trigger === 'quality-regression'));
const suppressedNoise = runQualityPolice({
    qualityComparisonReport: {
        reportId: 'q-3',
        atomId: 'atom.noise',
        fromVersion: '1.0.0',
        toVersion: '1.0.2',
        regressedMetrics: [],
        mapImpactScope: { propagationStatus: [{ mapId: 'map.a', integrationTestPassed: true }] },
        dedupCandidates: [{ atomId: 'atom.hint', similarity: 0.8 }]
    }
});
assert.equal(suppressedNoise.status, 'pass');
assert.ok(suppressedNoise.findings.every((f) => f.severity === 'advisory'));
assert.ok(suppressedNoise.findings.some((f) => f.trigger === 'quality-dedup-candidate'));
console.log('quality.spec.ts: ok');
