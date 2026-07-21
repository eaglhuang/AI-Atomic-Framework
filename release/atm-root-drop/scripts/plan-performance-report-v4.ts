import { createHash } from 'node:crypto';

export type PairedAbV4Arm = 'serial' | 'queue-only' | 'atm-compose-first' | 'isolated-git-branch-merge';
export type PairedAbV4Contention = 'disjoint' | 'same-file-disjoint-anchor' | 'commutative-cid' | 'noncommutative-cid' | 'generated-shared-surface';

export type PairedAbV4Cell = {
  readonly arm: PairedAbV4Arm;
  readonly scale: number;
  readonly contention: PairedAbV4Contention;
  readonly repeat: number;
  readonly makespanMs: number;
  readonly activeThroughput: number;
  readonly productionCostUnits: number;
  readonly workloadReceipts?: readonly PairedAbV4CommandReceipt[];
  readonly sideEffectCounts: {
    readonly silentOverwrite: number;
    readonly escapedConflict: number;
    readonly duplicateSideEffect: number;
    readonly unresolvedStarvation: number;
  };
};

export type PairedAbV4CommandReceipt = {
  readonly command: string;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly durationMs: number;
  readonly exitCode: number;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
};

export type PairedAbV4Summary = {
  readonly schemaId: 'atm.pairedAbV4Summary.v1';
  readonly taskId: 'ATM-GOV-0224';
  readonly generatedAt: string;
  readonly cellCount: number;
  readonly requiredCellCount: 420;
  readonly arms: readonly PairedAbV4Arm[];
  readonly scales: readonly number[];
  readonly contentions: readonly PairedAbV4Contention[];
  readonly repeats: readonly number[];
  readonly metrics: {
    readonly medianMakespanImprovementPct: number;
    readonly activeThroughputImprovementPct: number;
    readonly productionCostRatio: number;
    readonly coveragePct: number;
  };
  readonly sideEffectCounts: {
    readonly silentOverwrite: number;
    readonly escapedConflict: number;
    readonly duplicateSideEffect: number;
    readonly unresolvedStarvation: number;
  };
  readonly safetyController: {
    readonly verdict: 'pass' | 'trip';
    readonly fallbackMode: 'queue-only';
    readonly evidenceDigest: string;
    readonly resetEligible: boolean;
    readonly blockers: readonly string[];
  };
  readonly taskSummary: {
    readonly window: string;
    readonly watermark: string;
    readonly sealedDigest: string;
  };
  readonly artifacts: {
    readonly summaryPath: string;
    readonly cellsPath: string;
    readonly reportPath: string;
  };
  readonly verdict: 'pass' | 'fail';
};

export function buildPairedAbV4Markdown(summary: PairedAbV4Summary): string {
  return [
    '# ATM 2.1 Paired AB v4',
    '',
    `Generated: ${summary.generatedAt}`,
    `Task: ${summary.taskId}`,
    `Verdict: ${summary.verdict}`,
    '',
    '## Matrix',
    '',
    `- cells: ${summary.cellCount}/${summary.requiredCellCount}`,
    `- arms: ${summary.arms.join(', ')}`,
    `- scales: ${summary.scales.join(', ')}`,
    `- contentions: ${summary.contentions.join(', ')}`,
    `- repeats: ${summary.repeats.join(', ')}`,
    '',
    '## Metrics',
    '',
    `- median makespan improvement: ${summary.metrics.medianMakespanImprovementPct}%`,
    `- active throughput improvement: ${summary.metrics.activeThroughputImprovementPct}%`,
    `- production cost ratio: ${summary.metrics.productionCostRatio}`,
    `- coverage: ${summary.metrics.coveragePct}%`,
    '',
    '## Safety',
    '',
    `- controller verdict: ${summary.safetyController.verdict}`,
    `- fallback mode: ${summary.safetyController.fallbackMode}`,
    `- reset eligible: ${summary.safetyController.resetEligible}`,
    `- evidence digest: ${summary.safetyController.evidenceDigest}`,
    `- silent overwrite: ${summary.sideEffectCounts.silentOverwrite}`,
    `- escaped conflict: ${summary.sideEffectCounts.escapedConflict}`,
    `- duplicate side effect: ${summary.sideEffectCounts.duplicateSideEffect}`,
    `- unresolved starvation: ${summary.sideEffectCounts.unresolvedStarvation}`,
    '',
    '## Task Summary',
    '',
    `- window: ${summary.taskSummary.window}`,
    `- watermark: ${summary.taskSummary.watermark}`,
    `- sealed digest: ${summary.taskSummary.sealedDigest}`,
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
  if (summary.cellCount !== 420 || summary.requiredCellCount !== 420) findings.push('cell count must be 420');
  if (summary.metrics.medianMakespanImprovementPct < 25) findings.push('median makespan improvement must be >= 25%');
  if (summary.metrics.activeThroughputImprovementPct < 25) findings.push('active throughput improvement must be >= 25%');
  if (summary.metrics.productionCostRatio > 1.10) findings.push('production cost ratio must be <= 1.10');
  if (summary.metrics.coveragePct !== 100) findings.push('coverage must be 100%');
  if (summary.sideEffectCounts.silentOverwrite !== 0) findings.push('silentOverwrite must be 0');
  if (summary.sideEffectCounts.escapedConflict !== 0) findings.push('escapedConflict must be 0');
  if (summary.sideEffectCounts.duplicateSideEffect !== 0) findings.push('duplicateSideEffect must be 0');
  if (summary.sideEffectCounts.unresolvedStarvation !== 0) findings.push('unresolvedStarvation must be 0');
  if (summary.safetyController.verdict !== 'pass') findings.push('safety controller must pass');
  if (summary.safetyController.fallbackMode !== 'queue-only') findings.push('fallback mode must be queue-only');
  if (!summary.safetyController.resetEligible) findings.push('safety controller must be reset eligible');
  if (!summary.safetyController.evidenceDigest.startsWith('sha256:')) findings.push('safety digest missing');
  if (!summary.taskSummary.window) findings.push('task summary window missing');
  if (!summary.taskSummary.watermark) findings.push('task summary watermark missing');
  if (!summary.taskSummary.sealedDigest.startsWith('sha256:')) findings.push('sealed digest missing');
  if (summary.verdict !== 'pass') findings.push('verdict must be pass');
  return findings;
}

export function digestObject(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
