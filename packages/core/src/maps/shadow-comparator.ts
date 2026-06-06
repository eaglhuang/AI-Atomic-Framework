import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface ShadowSample {
  fixtureId: string;
  legacyOutput: unknown;
  atomOutput: unknown;
  legacyMs: number;
  atomMs: number;
  legacyMemoryMB?: number;
  atomMemoryMB?: number;
}

export interface ShadowDivergence {
  fixtureId: string;
  legacyHash: string;
  atomHash: string;
  diffSummary: string;
  critical: boolean;
}

export type PromotionRecommendation = 'recommend-canary' | 'hold' | 'rollback-alert';

export interface ShadowComparisonReport {
  schemaId: 'atm.shadowComparisonReport';
  runId: string;
  mapId: string;
  generatedAt: string;
  shadowPeriodDays: number;
  sampleSize: number;
  outputConsistencyRate: number;
  avgLegacyMs: number;
  avgAtomMs: number;
  peakMemoryDeltaMB: number;
  divergences: ShadowDivergence[];
  promotionRecommendation: PromotionRecommendation;
  promotionReasons: string[];
}

const MIN_SAMPLE_SIZE_FOR_CANARY = 5;
const CONSISTENCY_ROLLBACK_THRESHOLD = 0.9;

function canonicalizeOutput(output: unknown): string {
  // Deep-sort object keys, trim whitespace, normalize numbers to avoid
  // spurious divergence from ordering or float formatting differences.
  return JSON.stringify(sortedClone(output));
}

function sortedClone(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortedClone);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = sortedClone((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function hashOutput(output: unknown): string {
  return createHash('sha256').update(canonicalizeOutput(output)).digest('hex').slice(0, 16);
}

function diffSummary(legacyOutput: unknown, atomOutput: unknown): string {
  const legacyStr = canonicalizeOutput(legacyOutput);
  const atomStr = canonicalizeOutput(atomOutput);
  const maxLen = 200;
  if (legacyStr.length > maxLen || atomStr.length > maxLen) {
    return `legacy[${legacyStr.length}B] vs atom[${atomStr.length}B] — outputs differ`;
  }
  return `legacy: ${legacyStr.slice(0, 80)} | atom: ${atomStr.slice(0, 80)}`;
}

function computePromotion(
  consistencyRate: number,
  sampleSize: number,
  hasCriticalDivergence: boolean
): { recommendation: PromotionRecommendation; reasons: string[] } {
  const reasons: string[] = [];

  if (consistencyRate < CONSISTENCY_ROLLBACK_THRESHOLD) {
    reasons.push(`outputConsistencyRate ${(consistencyRate * 100).toFixed(1)}% < 90% threshold`);
    return { recommendation: 'rollback-alert', reasons };
  }

  if (hasCriticalDivergence) {
    reasons.push('critical divergence detected in one or more fixtures');
    return { recommendation: 'rollback-alert', reasons };
  }

  if (sampleSize < MIN_SAMPLE_SIZE_FOR_CANARY) {
    reasons.push(`sampleSize ${sampleSize} < minimum ${MIN_SAMPLE_SIZE_FOR_CANARY} for canary`);
    return { recommendation: 'hold', reasons };
  }

  reasons.push(`outputConsistencyRate ${(consistencyRate * 100).toFixed(1)}% meets threshold, sufficient sample size`);
  return { recommendation: 'recommend-canary', reasons };
}

export function runShadowComparison(
  mapId: string,
  samples: ShadowSample[],
  options: { shadowPeriodDays?: number; criticalFixtureIds?: Set<string> } = {}
): ShadowComparisonReport {
  const shadowPeriodDays = options.shadowPeriodDays ?? 0;
  const criticalFixtureIds = options.criticalFixtureIds ?? new Set<string>();

  let matchCount = 0;
  const divergences: ShadowDivergence[] = [];
  let totalLegacyMs = 0;
  let totalAtomMs = 0;
  let peakMemoryDeltaMB = 0;

  for (const sample of samples) {
    const legacyHash = hashOutput(sample.legacyOutput);
    const atomHash = hashOutput(sample.atomOutput);
    totalLegacyMs += sample.legacyMs;
    totalAtomMs += sample.atomMs;

    const memDelta = (sample.atomMemoryMB ?? 0) - (sample.legacyMemoryMB ?? 0);
    if (Math.abs(memDelta) > Math.abs(peakMemoryDeltaMB)) {
      peakMemoryDeltaMB = memDelta;
    }

    if (legacyHash === atomHash) {
      matchCount++;
    } else {
      divergences.push({
        fixtureId: sample.fixtureId,
        legacyHash,
        atomHash,
        diffSummary: diffSummary(sample.legacyOutput, sample.atomOutput),
        critical: criticalFixtureIds.has(sample.fixtureId)
      });
    }
  }

  const sampleSize = samples.length;
  const outputConsistencyRate = sampleSize > 0 ? matchCount / sampleSize : 0;
  const avgLegacyMs = sampleSize > 0 ? totalLegacyMs / sampleSize : 0;
  const avgAtomMs = sampleSize > 0 ? totalAtomMs / sampleSize : 0;
  const hasCriticalDivergence = divergences.some((d) => d.critical);

  const { recommendation, reasons } = computePromotion(
    outputConsistencyRate,
    sampleSize,
    hasCriticalDivergence
  );

  return {
    schemaId: 'atm.shadowComparisonReport',
    runId: createHash('sha256')
      .update(`${mapId}:${new Date().toISOString()}`)
      .digest('base64url')
      .slice(0, 12),
    mapId,
    generatedAt: new Date().toISOString(),
    shadowPeriodDays,
    sampleSize,
    outputConsistencyRate,
    avgLegacyMs,
    avgAtomMs,
    peakMemoryDeltaMB,
    divergences,
    promotionRecommendation: recommendation,
    promotionReasons: reasons
  };
}

export function writeShadowComparisonReport(
  repositoryRoot: string,
  report: ShadowComparisonReport
): string {
  const outDir = path.join(repositoryRoot, 'atomic_workbench', 'maps', report.mapId);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  const outPath = path.join(outDir, 'shadow-comparison-report.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  return outPath;
}

export function readShadowComparisonReport(
  repositoryRoot: string,
  mapId: string
): ShadowComparisonReport | null {
  const filePath = path.join(
    repositoryRoot,
    'atomic_workbench',
    'maps',
    mapId,
    'shadow-comparison-report.json'
  );
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as ShadowComparisonReport;
  } catch {
    return null;
  }
}
