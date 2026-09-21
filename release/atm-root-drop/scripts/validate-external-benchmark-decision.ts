import { createValidator } from './lib/validator-harness.ts';
import { decideBenchmark } from './lib/external-benchmark/report.ts';
import type { RawBenchmarkAggregate } from './lib/external-benchmark/metrics.ts';
import type { AdjudicationRates } from './lib/external-benchmark/adjudication.ts';

const harness = createValidator('external-benchmark-decision', { argv: process.argv.slice(2), defaultMode: 'validate' });

const aggregate = (arm: 'baseline' | 'atm', billedCost: number): RawBenchmarkAggregate => ({
  arm, runCount: 2, durationMs: [1000, 1200], p95DurationMs: 1200, billedCost, humanMinutes: 2, retries: 0
});
const safe: AdjudicationRates = { falseBlockRate: 0.1, missedConflictRate: 0.1, completionRate: 0.9 };

function validate(): void {
  harness.requireFile('scripts/lib/external-benchmark/report.ts');
  const keep = decideBenchmark({ eligible: true, blockingReasons: [], rounds: ['AB', 'BA'], baseline: aggregate('baseline', 100), atm: aggregate('atm', 75), baselineSafety: safe, atmSafety: safe });
  harness.assert(keep.verdict === 'keep' && keep.primaryCostImprovement === 0.25, 'keep requires safety non-inferiority and at least 20% cost improvement');
  const narrow = decideBenchmark({ eligible: true, blockingReasons: [], rounds: ['AB', 'BA'], baseline: aggregate('baseline', 100), atm: aggregate('atm', 90), baselineSafety: safe, atmSafety: safe });
  harness.assert(narrow.verdict === 'narrow', 'safe but sub-threshold cost improvement must narrow');
  const stop = decideBenchmark({ eligible: true, blockingReasons: [], rounds: ['AB', 'BA'], baseline: aggregate('baseline', 100), atm: aggregate('atm', 75), baselineSafety: safe, atmSafety: { ...safe, missedConflictRate: 0.2 } });
  harness.assert(stop.verdict === 'stop', 'safety regression must stop');
  const blocked = decideBenchmark({ eligible: false, blockingReasons: ['hidden corpus acceptance missing'], rounds: [] });
  harness.assert(blocked.verdict === 'inconclusive', 'ineligible runs must remain inconclusive');
  harness.ok('decision=keep|narrow|stop|inconclusive threshold=20% safety=non-inferior');
}

validate();
