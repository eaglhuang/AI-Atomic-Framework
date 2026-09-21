import { createHash } from 'node:crypto';
export const PERFORMANCE_RESILIENCE_RATCHET_SCHEMA_ID = 'atm.performanceResilienceRatchet.v1';
export const PERFORMANCE_RESILIENCE_RATCHET_COMPILER_ID = 'atm.performance-resilience-ratchet.compiler.v1';
const supportedMetrics = ['latencyMs', 'memoryBytes', 'successRate', 'resilienceRate'];
export function compilePerformanceResilienceRatchet(input) {
    const authorityWasSealed = input.authority?.sealed === true, n = normalize(input), diagnostics = [];
    if (!n.ratchetId || !n.generatedAt || !n.baselines.length || !n.observations.length)
        diagnostics.push('receipt-incomplete');
    if (!n.authority.authorityId || !n.authority.digest || !authorityWasSealed)
        diagnostics.push('authority-incomplete');
    if (n.observedAuthorityDigest !== n.authority.digest)
        diagnostics.push('authority-digest-mismatch');
    if (!validLimits(n.limits))
        diagnostics.push('invalid-limits');
    for (const metric of n.metrics)
        if (!supportedMetrics.includes(metric))
            diagnostics.push(`unsupported-metric:${metric}`);
    const baselines = new Map();
    for (const benchmark of n.baselines) {
        if (baselines.has(benchmark.benchmarkId))
            diagnostics.push(`duplicate-baseline:${benchmark.benchmarkId}`);
        baselines.set(benchmark.benchmarkId, benchmark);
        validateBenchmark(benchmark, diagnostics, 'baseline');
    }
    const observationIds = new Set(), regressions = [], passed = [];
    for (const observation of n.observations) {
        if (observationIds.has(observation.benchmarkId))
            diagnostics.push(`duplicate-observation:${observation.benchmarkId}`);
        observationIds.add(observation.benchmarkId);
        validateBenchmark(observation, diagnostics, 'observation');
        const baseline = baselines.get(observation.benchmarkId);
        if (!baseline) {
            diagnostics.push(`missing-baseline:${observation.benchmarkId}`);
            continue;
        }
        const failed = metricRegressions(observation, baseline, n.limits, n.metrics);
        if (failed.length)
            regressions.push(...failed);
        else
            passed.push(observation.benchmarkId);
    }
    for (const benchmarkId of baselines.keys())
        if (!observationIds.has(benchmarkId))
            diagnostics.push(`missing-observation:${benchmarkId}`);
    if (regressions.length)
        diagnostics.push('ratchet-regression');
    const status = diagnostics.some(code => code.startsWith('duplicate-') || code.startsWith('invalid-') || code.startsWith('missing-') || code.startsWith('unsupported-') || code === 'receipt-incomplete' || code === 'authority-incomplete') ? 'contradictory' : diagnostics.some(code => code.includes('authority')) ? 'stale' : diagnostics.length ? 'blocked' : 'proven';
    const projection = { benchmarkCount: n.observations.length, regressions: regressions.sort(), passed: passed.sort() }, repairCommand = status === 'proven' ? null : 'rebuild the sealed benchmark baseline and rerun the ratchet compiler';
    return seal({ schemaId: PERFORMANCE_RESILIENCE_RATCHET_SCHEMA_ID, specVersion: '0.1.0', compilerId: PERFORMANCE_RESILIENCE_RATCHET_COMPILER_ID, ratchetId: n.ratchetId, generatedAt: n.generatedAt, authority: n.authority, limits: n.limits, baselines: n.baselines, observations: n.observations, projection, status, diagnostics, repairCommand, provenance: n.provenance });
}
export const createPerformanceResilienceRatchet = compilePerformanceResilienceRatchet;
export function replayPerformanceResilienceRatchet(result) { return compilePerformanceResilienceRatchet({ ratchetId: result.ratchetId, generatedAt: result.generatedAt, authority: result.authority, observedAuthorityDigest: result.authority.digest, baselines: result.baselines, observations: result.observations, limits: result.limits, metrics: supportedMetrics, provenance: result.provenance }); }
export function validatePerformanceResilienceRatchet(result) { const replay = replayPerformanceResilienceRatchet(result), diagnostics = [...result.diagnostics], actual = digest(unsigned(result)); if (actual !== result.resultDigest || replay.resultDigest !== result.resultDigest)
    diagnostics.push('result-digest-mismatch'); return { ok: diagnostics.length === 0 && result.status === 'proven', diagnostics: [...new Set(diagnostics)] }; }
function metricRegressions(observation, baseline, limits, metrics) { const checks = { latencyMs: observation.latencyMs - baseline.latencyMs > limits.maxLatencyRegressionMs, memoryBytes: observation.memoryBytes - baseline.memoryBytes > limits.maxMemoryRegressionBytes, successRate: observation.successRate < limits.minSuccessRate, resilienceRate: observation.resilienceRate < limits.minResilienceRate }; return supportedMetrics.filter(metric => metrics.includes(metric) && checks[metric]).map(metric => `${observation.benchmarkId}:${metric}`); }
function validLimits(limits) { return Number.isFinite(limits.maxLatencyRegressionMs) && limits.maxLatencyRegressionMs >= 0 && Number.isFinite(limits.maxMemoryRegressionBytes) && limits.maxMemoryRegressionBytes >= 0 && [limits.minSuccessRate, limits.minResilienceRate].every(value => Number.isFinite(value) && value >= 0 && value <= 1); }
function validateBenchmark(benchmark, diagnostics, kind) { if (!benchmark.benchmarkId || !benchmark.digest || ![benchmark.latencyMs, benchmark.memoryBytes, benchmark.successRate, benchmark.resilienceRate].every(Number.isFinite) || benchmark.latencyMs < 0 || benchmark.memoryBytes < 0 || benchmark.successRate < 0 || benchmark.successRate > 1 || benchmark.resilienceRate < 0 || benchmark.resilienceRate > 1)
    diagnostics.push(`invalid-${kind}:${benchmark.benchmarkId}`); }
function normalize(input) { const benchmark = (value) => ({ benchmarkId: String(value?.benchmarkId ?? '').trim(), latencyMs: Number(value?.latencyMs), memoryBytes: Number(value?.memoryBytes), successRate: Number(value?.successRate), resilienceRate: Number(value?.resilienceRate), digest: String(value?.digest ?? '').trim() }); return { ratchetId: String(input.ratchetId ?? '').trim(), generatedAt: String(input.generatedAt ?? '').trim(), authority: { authorityId: String(input.authority?.authorityId ?? '').trim(), digest: String(input.authority?.digest ?? '').trim(), sealed: true }, observedAuthorityDigest: String(input.observedAuthorityDigest ?? '').trim(), metrics: [...(input.metrics ?? supportedMetrics)].map(String).sort(), limits: { maxLatencyRegressionMs: Number(input.limits?.maxLatencyRegressionMs), maxMemoryRegressionBytes: Number(input.limits?.maxMemoryRegressionBytes), minSuccessRate: Number(input.limits?.minSuccessRate), minResilienceRate: Number(input.limits?.minResilienceRate) }, baselines: [...(input.baselines ?? [])].map(benchmark).sort((left, right) => left.benchmarkId.localeCompare(right.benchmarkId)), observations: [...(input.observations ?? [])].map(benchmark).sort((left, right) => left.benchmarkId.localeCompare(right.benchmarkId)), provenance: input.provenance ?? {} }; }
function seal(value) { return { ...value, resultDigest: digest(value) }; }
function unsigned(result) { const { resultDigest: _ignored, ...value } = result; return value; }
function digest(value) { return `sha256:${createHash('sha256').update(JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item)).digest('hex')}`; }
