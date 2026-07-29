import { createHash } from 'node:crypto';

export type PairedAbV4Arm = 'queue-only' | 'atm-compose-first';
export type PairedAbV4Contention = 'disjoint' | 'same-file-disjoint-anchor' | 'commutative-cid' | 'noncommutative-cid' | 'generated-shared-surface';
export type PairedAbV4Order = 'AA' | 'AB' | 'BA';

export type PairedAbV4CommandReceipt = {
  readonly command: string;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly durationMs: number;
  readonly exitCode: number;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
  readonly workloadDigest: string;
  readonly workloadUnits: number;
};

export type PairedAbV4TimingSegments = {
  readonly proposalGenerationMs: number;
  readonly proposalValidationMs: number;
  readonly composePlanningMs: number;
  readonly stewardApplyMs: number;
  readonly sharedCommitMs: number;
};

export type PairedAbV4Run = {
  readonly arm: PairedAbV4Arm;
  readonly order: PairedAbV4Order;
  readonly repeat: number;
  readonly makespanMs: number;
  readonly activeThroughput: number;
  readonly productionCostUnits: number;
  readonly timing: PairedAbV4TimingSegments;
  readonly commandReceipts: readonly PairedAbV4CommandReceipt[];
  readonly receiptDigest: string;
};

export type PairedAbV4Cell = {
  readonly cellId: string;
  readonly scale: number;
  readonly contention: PairedAbV4Contention;
  readonly workloadDigest: string;
  readonly aaNullControl: readonly PairedAbV4Run[];
  readonly abRepeats: readonly PairedAbV4Run[];
  readonly baRepeats: readonly PairedAbV4Run[];
  readonly negativeControl: {
    readonly name: 'serializable-but-semantically-broken';
    readonly rejectedBeforeCanonicalWrite: true;
    readonly receiptDigest: string;
  };
  readonly verdict: 'accepted' | 'inconclusive';
};

export type PairedAbV4Summary = {
  readonly schemaId: 'atm.pairedAbV4Summary.v1';
  readonly taskId: 'ATM-GOV-0243';
  readonly generatedAt: string;
  readonly cellCount: number;
  readonly requiredCellCount: 70;
  readonly acceptedCellCount: number;
  readonly arms: readonly PairedAbV4Arm[];
  readonly scales: readonly number[];
  readonly contentions: readonly PairedAbV4Contention[];
  readonly repeatsPerOrder: 3;
  readonly metrics: {
    readonly medianMakespanImprovementPct: number;
    readonly activeThroughputImprovementPct: number;
    readonly productionCostRatio: number;
    readonly aaNoiseBoundPct: number;
    readonly coveragePct: number;
  };
  readonly timingSegments: readonly (keyof PairedAbV4TimingSegments)[];
  readonly sideEffectCounts: {
    readonly silentOverwrite: number;
    readonly escapedConflict: number;
    readonly duplicateSideEffect: number;
    readonly unresolvedStarvation: number;
  };
  readonly correctness: {
    readonly negativeControlRejectedBeforeCanonicalWrite: true;
    readonly canonicalWriteParallelismClaim: 'serialized-steward-tail-only';
  };
  readonly artifacts: {
    readonly summaryPath: string;
    readonly cellsPath: string;
    readonly reportPath: string;
  };
  readonly verdict: 'pass' | 'inconclusive' | 'fail';
};

export function buildPairedAbV4Markdown(summary: PairedAbV4Summary): string {
  return [
    '# ATM 3.1 Paired AB/BA Governed Workload Benchmark',
    '',
    `Generated: ${summary.generatedAt}`,
    `Task: ${summary.taskId}`,
    `Verdict: ${summary.verdict}`,
    '',
    '## Matrix',
    '',
    `- accepted cells: ${summary.acceptedCellCount}/${summary.requiredCellCount}`,
    `- arms: ${summary.arms.join(', ')}`,
    `- scales: ${summary.scales.join(', ')}`,
    `- contentions: ${summary.contentions.join(', ')}`,
    `- repeats per AB and BA order: ${summary.repeatsPerOrder}`,
    '',
    '## Metrics',
    '',
    `- median makespan improvement: ${summary.metrics.medianMakespanImprovementPct}%`,
    `- active throughput improvement: ${summary.metrics.activeThroughputImprovementPct}%`,
    `- production cost ratio: ${summary.metrics.productionCostRatio}`,
    `- A/A noise bound: ${summary.metrics.aaNoiseBoundPct}%`,
    `- coverage: ${summary.metrics.coveragePct}%`,
    '',
    '## Correctness',
    '',
    `- negative control rejected before canonical write: ${summary.correctness.negativeControlRejectedBeforeCanonicalWrite}`,
    `- canonical write parallelism claim: ${summary.correctness.canonicalWriteParallelismClaim}`,
    `- timing segments: ${summary.timingSegments.join(', ')}`,
    '',
    '## Safety',
    '',
    `- silent overwrite: ${summary.sideEffectCounts.silentOverwrite}`,
    `- escaped conflict: ${summary.sideEffectCounts.escapedConflict}`,
    `- duplicate side effect: ${summary.sideEffectCounts.duplicateSideEffect}`,
    `- unresolved starvation: ${summary.sideEffectCounts.unresolvedStarvation}`,
    '',
    '## Artifacts',
    '',
    `- Summary: ${summary.artifacts.summaryPath}`,
    `- Cells: ${summary.artifacts.cellsPath}`,
    `- Report: ${summary.artifacts.reportPath}`,
    ''
  ].join('\n');
}

export function validatePairedAbV4Summary(summary: PairedAbV4Summary): readonly string[] {
  const findings: string[] = [];
  if (summary.schemaId !== 'atm.pairedAbV4Summary.v1') findings.push('schemaId mismatch');
  if (summary.taskId !== 'ATM-GOV-0243') findings.push('task id mismatch');
  if (summary.cellCount !== 70 || summary.requiredCellCount !== 70) findings.push('cell count must be 70 paired comparison cells');
  if (summary.acceptedCellCount !== summary.requiredCellCount) findings.push('all paired cells must be accepted');
  if (summary.repeatsPerOrder !== 3) findings.push('AB and BA each require three repeats');
  if (summary.metrics.medianMakespanImprovementPct < 25) findings.push('median makespan improvement must be >= 25%');
  if (summary.metrics.medianMakespanImprovementPct <= summary.metrics.aaNoiseBoundPct) findings.push('improvement must exceed A/A noise bound');
  if (summary.metrics.activeThroughputImprovementPct < 25) findings.push('active throughput improvement must be >= 25%');
  if (summary.metrics.productionCostRatio > 1.10) findings.push('production cost ratio must be <= 1.10');
  if (summary.metrics.coveragePct !== 100) findings.push('coverage must be 100%');
  if (!summary.correctness.negativeControlRejectedBeforeCanonicalWrite) findings.push('negative control must be rejected before canonical write');
  if (summary.correctness.canonicalWriteParallelismClaim !== 'serialized-steward-tail-only') findings.push('canonical write parallelism claim must be bounded');
  if (summary.sideEffectCounts.silentOverwrite !== 0) findings.push('silentOverwrite must be 0');
  if (summary.sideEffectCounts.escapedConflict !== 0) findings.push('escapedConflict must be 0');
  if (summary.sideEffectCounts.duplicateSideEffect !== 0) findings.push('duplicateSideEffect must be 0');
  if (summary.sideEffectCounts.unresolvedStarvation !== 0) findings.push('unresolvedStarvation must be 0');
  if (summary.verdict !== 'pass') findings.push('verdict must be pass');
  return findings;
}

export function digestObject(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
