import type { AdjudicationRates } from './adjudication.ts';
import type { RawBenchmarkAggregate } from './metrics.ts';

export type ProductDecision = 'keep' | 'narrow' | 'stop' | 'inconclusive';

export interface BenchmarkDecisionInput {
  readonly eligible: boolean;
  readonly blockingReasons: readonly string[];
  readonly rounds: readonly string[];
  readonly baseline?: RawBenchmarkAggregate;
  readonly atm?: RawBenchmarkAggregate;
  readonly baselineSafety?: AdjudicationRates;
  readonly atmSafety?: AdjudicationRates;
}

export interface BenchmarkDecision {
  readonly verdict: ProductDecision;
  readonly rationale: readonly string[];
  readonly primaryCostImprovement: number | null;
}

export function decideBenchmark(input: BenchmarkDecisionInput): BenchmarkDecision {
  if (!input.eligible) return { verdict: 'inconclusive', rationale: [...input.blockingReasons], primaryCostImprovement: null };
  if (!input.baseline || !input.atm || !input.baselineSafety || !input.atmSafety || input.rounds.length < 2 || !new Set(input.rounds).has('AB') || !new Set(input.rounds).has('BA')) {
    return { verdict: 'inconclusive', rationale: ['two independent AB and BA rounds with raw cost and independent adjudication are required'], primaryCostImprovement: null };
  }
  if (input.baseline.billedCost === null || input.atm.billedCost === null || input.baseline.billedCost <= 0) {
    return { verdict: 'inconclusive', rationale: ['raw billed-cost telemetry is unavailable'], primaryCostImprovement: null };
  }
  const improvement = (input.baseline.billedCost - input.atm.billedCost) / input.baseline.billedCost;
  const safetyNonInferior = input.atmSafety.missedConflictRate <= input.baselineSafety.missedConflictRate
    && input.atmSafety.falseBlockRate <= input.baselineSafety.falseBlockRate;
  if (safetyNonInferior && improvement >= 0.2) return { verdict: 'keep', rationale: ['safety is non-inferior and raw billed cost improved by at least 20%'], primaryCostImprovement: improvement };
  if (!safetyNonInferior) return { verdict: 'stop', rationale: ['safety non-inferiority or false-block requirement failed; name the smallest optional capability before a narrow retest'], primaryCostImprovement: improvement };
  return { verdict: 'narrow', rationale: ['safety passed but the preregistered primary cost threshold was not met'], primaryCostImprovement: improvement };
}

export function renderDecisionMarkdown(decision: BenchmarkDecision): string {
  const improvement = decision.primaryCostImprovement === null ? 'unavailable' : `${(decision.primaryCostImprovement * 100).toFixed(2)}%`;
  return `# ATM external benchmark decision\n\n- Verdict: **${decision.verdict}**\n- Primary billed-cost improvement: ${improvement}\n\n## Rationale\n\n${decision.rationale.map((reason) => `- ${reason}`).join('\n')}\n`;
}
