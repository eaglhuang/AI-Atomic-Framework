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
}

export interface AdjudicationRates {
  readonly falseBlockRate: number;
  readonly missedConflictRate: number;
  readonly completionRate: number;
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
  return {
    falseBlockRate: selected.filter((record) => record.falseBlock).length / selected.length,
    missedConflictRate: selected.filter((record) => record.missedConflict).length / selected.length,
    completionRate: selected.filter((record) => record.completed).length / selected.length
  };
}
