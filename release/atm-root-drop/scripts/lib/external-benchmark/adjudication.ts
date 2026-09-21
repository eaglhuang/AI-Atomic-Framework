import type { BenchmarkArm } from './metrics.ts';

export interface OracleAdjudication {
  readonly runId: string;
  readonly adjudicator: string;
  readonly hiddenCorpusOwner: string;
  readonly implementer: string;
  readonly arm: BenchmarkArm;
  readonly falseBlock: boolean;
  readonly missedConflict: boolean;
  readonly completed: boolean;
  readonly truth?: 'benign' | 'conflict' | 'unknown';
  readonly decision?: 'allowed' | 'blocked' | 'unknown';
}

export interface AdjudicationRates {
  readonly falseBlockRate: number;
  readonly missedConflictRate: number;
  readonly completionRate: number;
  readonly falseBlockCount?: number;
  readonly falseBlockDenominator?: number;
  readonly missedConflictCount?: number;
  readonly missedConflictDenominator?: number;
  readonly unavailableCount?: number;
}

export function validateIndependentAdjudications(records: readonly OracleAdjudication[]): void {
  if (records.length === 0) throw new Error('independent oracle adjudication is required');
  for (const record of records) {
    if (!record.runId || !record.adjudicator || !record.hiddenCorpusOwner || !record.implementer) throw new Error('adjudication record lacks identity');
    if (record.adjudicator === record.hiddenCorpusOwner || record.adjudicator === record.implementer || record.hiddenCorpusOwner === record.implementer) {
      throw new Error('oracle, adjudicator, and implementer must be independent');
    }
    if (record.arm !== 'baseline' && record.arm !== 'atm') throw new Error('adjudication arm is invalid');
  }
}

export function calculateAdjudicationRates(records: readonly OracleAdjudication[], arm: BenchmarkArm): AdjudicationRates {
  validateIndependentAdjudications(records);
  const selected = records.filter((record) => record.arm === arm);
  if (selected.length === 0) throw new Error(`no independent adjudications for ${arm}`);
  const explicit = selected.some(record => record.truth !== undefined || record.decision !== undefined);
  const falseBlockDenominator = explicit ? selected.filter(record => record.truth === 'benign' && record.decision !== 'unknown').length : selected.length;
  const missedConflictDenominator = explicit ? selected.filter(record => record.truth === 'conflict' && record.decision !== 'unknown').length : selected.length;
  const falseBlockCount = explicit ? selected.filter(record => record.truth === 'benign' && record.decision === 'blocked').length : selected.filter(record => record.falseBlock).length;
  const missedConflictCount = explicit ? selected.filter(record => record.truth === 'conflict' && record.decision === 'allowed').length : selected.filter(record => record.missedConflict).length;
  const unavailableCount = explicit ? selected.filter(record => record.truth === 'unknown' || record.decision === 'unknown' || record.truth === undefined || record.decision === undefined).length : 0;
  return { falseBlockRate: falseBlockDenominator ? falseBlockCount / falseBlockDenominator : Number.NaN, missedConflictRate: missedConflictDenominator ? missedConflictCount / missedConflictDenominator : Number.NaN, completionRate: selected.filter(record => record.completed).length / selected.length, falseBlockCount, falseBlockDenominator, missedConflictCount, missedConflictDenominator, unavailableCount };
}
