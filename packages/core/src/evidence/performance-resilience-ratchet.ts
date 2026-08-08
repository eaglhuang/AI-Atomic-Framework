import { createHash } from 'node:crypto';

export const PERFORMANCE_RESILIENCE_RATCHET_SCHEMA_ID = 'atm.performanceResilienceRatchet.v1' as const;
export const PERFORMANCE_RESILIENCE_RATCHET_COMPILER_ID = 'atm.performance-resilience-ratchet.compiler.v1' as const;
export type PerformanceResilienceStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export type PerformanceMetric = 'latencyMs' | 'memoryBytes' | 'successRate' | 'resilienceRate';

export interface PerformanceResilienceAuthority { readonly authorityId: string; readonly digest: string; readonly sealed: true; }
export interface PerformanceBenchmark {
  readonly benchmarkId: string;
  readonly latencyMs: number;
  readonly memoryBytes: number;
  readonly successRate: number;
  readonly resilienceRate: number;
  readonly digest: string;
}
export interface PerformanceResilienceLimits {
  readonly maxLatencyRegressionMs: number;
  readonly maxMemoryRegressionBytes: number;
  readonly minSuccessRate: number;
  readonly minResilienceRate: number;
}
export interface PerformanceResilienceInput {
  readonly ratchetId: string;
  readonly generatedAt: string;
  readonly authority: PerformanceResilienceAuthority;
  readonly observedAuthorityDigest: string;
  readonly baselines: readonly PerformanceBenchmark[];
  readonly observations: readonly PerformanceBenchmark[];
  readonly limits: PerformanceResilienceLimits;
  readonly metrics?: readonly string[];
}
export interface PerformanceResilienceResult {
  readonly schemaId: typeof PERFORMANCE_RESILIENCE_RATCHET_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly compilerId: typeof PERFORMANCE_RESILIENCE_RATCHET_COMPILER_ID;
  readonly ratchetId: string;
  readonly generatedAt: string;
  readonly authority: PerformanceResilienceAuthority;
  readonly limits: PerformanceResilienceLimits;
  readonly baselines: readonly PerformanceBenchmark[];
  readonly observations: readonly PerformanceBenchmark[];
  readonly projection: { readonly benchmarkCount: number; readonly regressions: readonly string[]; readonly passed: readonly string[] };
  readonly status: PerformanceResilienceStatus;
  readonly diagnostics: readonly string[];
  readonly repairCommand: string | null;
  readonly resultDigest: string;
}

export function compilePerformanceResilienceRatchet(input: PerformanceResilienceInput): PerformanceResilienceResult {
  const n = normalize(input);
  const diagnostics: string[] = [];
  if (!n.ratchetId || !n.generatedAt) diagnostics.push('incomplete-identity');
  if (!n.authority.sealed || !n.authority.digest || n.observedAuthorityDigest !== n.authority.digest) diagnostics.push('authority-digest-mismatch');
  const supported = new Set<PerformanceMetric>(['latencyMs', 'memoryBytes', 'successRate', 'resilienceRate']);
  for (const metric of n.metrics) if (!supported.has(metric as PerformanceMetric)) diagnostics.push(`unsupported-metric:${metric}`);
  const baselineIds = new Set<string>();
  const observationIds = new Set<string>();
  for (const benchmark of n.baselines) {
    if (baselineIds.has(benchmark.benchmarkId)) diagnostics.push(`duplicate-baseline:${benchmark.benchmarkId}`);
    baselineIds.add(benchmark.benchmarkId);
    validateBenchmark(benchmark, diagnostics, 'baseline');
  }
  for (const benchmark of n.observations) {
    if (observationIds.has(benchmark.benchmarkId)) diagnostics.push(`duplicate-observation:${benchmark.benchmarkId}`);
    observationIds.add(benchmark.benchmarkId);
    validateBenchmark(benchmark, diagnostics, 'observation');
  }
  const regressions: string[] = [];
  const passed: string[] = [];
  for (const observation of n.observations) {
    const baseline = n.baselines.find((candidate) => candidate.benchmarkId === observation.benchmarkId);
    if (!baseline) { diagnostics.push(`missing-baseline:${observation.benchmarkId}`); continue; }
    const checks = [
      [observation.latencyMs - baseline.latencyMs > n.limits.maxLatencyRegressionMs, 'latency'],
      [observation.memoryBytes - baseline.memoryBytes > n.limits.maxMemoryRegressionBytes, 'memory'],
      [observation.successRate < n.limits.minSuccessRate, 'success-rate'],
      [observation.resilienceRate < n.limits.minResilienceRate, 'resilience-rate'],
    ] as const;
    const failed = checks.filter(([bad]) => bad).map(([, metric]) => `${observation.benchmarkId}:${metric}`);
    if (failed.length) regressions.push(...failed); else passed.push(observation.benchmarkId);
  }
  for (const baseline of n.baselines) if (!observationIds.has(baseline.benchmarkId)) diagnostics.push(`missing-observation:${baseline.benchmarkId}`);
  if (regressions.length) diagnostics.push('ratchet-regression');
  const structural = diagnostics.some((entry) => entry.startsWith('duplicate-') || entry.startsWith('invalid-') || entry.startsWith('missing-') || entry.startsWith('unsupported-') || entry === 'incomplete-identity');
  const status: PerformanceResilienceStatus = structural ? 'contradictory' : diagnostics.some((entry) => entry.includes('authority')) ? 'stale' : diagnostics.length ? 'blocked' : 'proven';
  const projection = { benchmarkCount: n.observations.length, regressions, passed };
  const repairCommand = status === 'proven' ? null : 'rebuild the sealed benchmark baseline and rerun the ratchet compiler';
  return {
    schemaId: PERFORMANCE_RESILIENCE_RATCHET_SCHEMA_ID,
    specVersion: '0.1.0',
    compilerId: PERFORMANCE_RESILIENCE_RATCHET_COMPILER_ID,
    ratchetId: n.ratchetId,
    generatedAt: n.generatedAt,
    authority: n.authority,
    limits: n.limits,
    baselines: n.baselines,
    observations: n.observations,
    projection,
    status,
    diagnostics,
    repairCommand,
    resultDigest: digest({ ...n, projection, status, diagnostics, repairCommand }),
  };
}

export const createPerformanceResilienceRatchet = compilePerformanceResilienceRatchet;
export function replayPerformanceResilienceRatchet(result: PerformanceResilienceResult): PerformanceResilienceResult {
  return compilePerformanceResilienceRatchet({ ratchetId: result.ratchetId, generatedAt: result.generatedAt, authority: result.authority, observedAuthorityDigest: result.authority.digest, baselines: result.baselines, observations: result.observations, limits: result.limits });
}
export function validatePerformanceResilienceRatchet(result: PerformanceResilienceResult) {
  const replay = replayPerformanceResilienceRatchet(result);
  const diagnostics = [...result.diagnostics];
  if (replay.resultDigest !== result.resultDigest) diagnostics.push('result-digest-mismatch');
  return { ok: diagnostics.length === 0 && result.status === 'proven' && result.repairCommand === null, diagnostics: [...new Set(diagnostics)] };
}

function validateBenchmark(benchmark: PerformanceBenchmark, diagnostics: string[], kind: string) {
  if (!benchmark.benchmarkId || !benchmark.digest || !Number.isFinite(benchmark.latencyMs) || !Number.isFinite(benchmark.memoryBytes) || !Number.isFinite(benchmark.successRate) || !Number.isFinite(benchmark.resilienceRate)) diagnostics.push(`invalid-${kind}:${benchmark.benchmarkId}`);
  if (benchmark.latencyMs < 0 || benchmark.memoryBytes < 0 || benchmark.successRate < 0 || benchmark.successRate > 1 || benchmark.resilienceRate < 0 || benchmark.resilienceRate > 1) diagnostics.push(`invalid-${kind}:${benchmark.benchmarkId}`);
}
function normalize(input: PerformanceResilienceInput) {
  const benchmark = (value: PerformanceBenchmark) => ({ benchmarkId: String(value?.benchmarkId ?? '').trim(), latencyMs: Number(value?.latencyMs), memoryBytes: Number(value?.memoryBytes), successRate: Number(value?.successRate), resilienceRate: Number(value?.resilienceRate), digest: String(value?.digest ?? '').trim() });
  return {
    ratchetId: String(input.ratchetId ?? '').trim(), generatedAt: String(input.generatedAt ?? '').trim(), authority: { authorityId: String(input.authority?.authorityId ?? '').trim(), digest: String(input.authority?.digest ?? '').trim(), sealed: true as const }, observedAuthorityDigest: String(input.observedAuthorityDigest ?? '').trim(), metrics: [...(input.metrics ?? ['latencyMs', 'memoryBytes', 'successRate', 'resilienceRate'])].map(String).sort(),
    limits: { maxLatencyRegressionMs: Number(input.limits?.maxLatencyRegressionMs), maxMemoryRegressionBytes: Number(input.limits?.maxMemoryRegressionBytes), minSuccessRate: Number(input.limits?.minSuccessRate), minResilienceRate: Number(input.limits?.minResilienceRate) },
    baselines: [...(input.baselines ?? [])].map(benchmark).sort((a, b) => a.benchmarkId.localeCompare(b.benchmarkId)), observations: [...(input.observations ?? [])].map(benchmark).sort((a, b) => a.benchmarkId.localeCompare(b.benchmarkId)),
  };
}
function digest(value: unknown) { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
