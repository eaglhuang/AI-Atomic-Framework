import { calculateAdjudicationRates, type OracleAdjudication } from './adjudication.ts';
import { aggregateRawRuns, type RawBenchmarkRun } from './metrics.ts';
import { decideBenchmark, type BenchmarkDecision } from './report.ts';

export interface ProtocolManifest {
  readonly arms: { readonly atm: { readonly packageAvailability: 'sealed' | 'unavailable'; readonly packageVersion: string | null; readonly packageTarballSha256: string | null; readonly workspaceLink: boolean } };
  readonly executionPrerequisites: Record<string, { readonly sealed: boolean; readonly evidenceDigest: string | null }>;
  readonly runEligibility: { readonly eligible: boolean; readonly blockingReasons: readonly string[] };
}

const REQUIRED_EXECUTION_PREREQUISITES = [
  'publicNpm',
  'hiddenCorpusAcceptance',
  'independentAdjudication',
  'providerTelemetry'
] as const;

export function executeExternalBenchmark(protocol: ProtocolManifest, runs: readonly RawBenchmarkRun[], adjudications: readonly OracleAdjudication[]): BenchmarkDecision {
  const packageSealed = protocol.arms.atm.packageAvailability === 'sealed' && protocol.arms.atm.packageVersion !== null && protocol.arms.atm.packageTarballSha256 !== null && protocol.arms.atm.workspaceLink === false;
  const missingPrerequisites = REQUIRED_EXECUTION_PREREQUISITES.filter((name) => {
    const prerequisite = protocol.executionPrerequisites[name];
    return !prerequisite || !prerequisite.sealed || !/^sha256:[a-f0-9]{64}$/.test(prerequisite.evidenceDigest ?? '');
  });
  if (!protocol.runEligibility.eligible || !packageSealed || missingPrerequisites.length > 0) {
    return decideBenchmark({ eligible: false, blockingReasons: protocol.runEligibility.blockingReasons.length ? protocol.runEligibility.blockingReasons : missingPrerequisites.length ? missingPrerequisites : ['published ATM package is not sealed'] , rounds: [] });
  }
  const baseline = aggregateRawRuns(runs, 'baseline');
  const atm = aggregateRawRuns(runs, 'atm');
  const baselineSafety = calculateAdjudicationRates(adjudications, 'baseline');
  const atmSafety = calculateAdjudicationRates(adjudications, 'atm');
  const rounds = [...new Set(runs.map((run) => run.sequence))];
  return decideBenchmark({ eligible: true, blockingReasons: [], rounds, baseline, atm, baselineSafety, atmSafety });
}
