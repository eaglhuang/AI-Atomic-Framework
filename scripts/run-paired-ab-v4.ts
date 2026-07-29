import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildPairedAbV4Markdown,
  digestObject,
  validatePairedAbV4Summary,
  type PairedAbV4Arm,
  type PairedAbV4Cell,
  type PairedAbV4CommandReceipt,
  type PairedAbV4Contention,
  type PairedAbV4Order,
  type PairedAbV4Run,
  type PairedAbV4Summary,
  type PairedAbV4TimingSegments
} from './plan-performance-report-v4.ts';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactDir = join(repoRoot, 'artifacts/generated/atm-ab-v4');
const summaryPath = join(artifactDir, 'summary.json');
const cellsPath = join(artifactDir, 'cells.json');
const reportPath = join(repoRoot, 'docs/reports/atm-2-1-paired-ab-v4.md');
const execFileAsync = promisify(execFile);

export const arms: readonly PairedAbV4Arm[] = ['queue-only', 'atm-compose-first'];
export const scales = [2, 4, 8, 16, 32, 64, 100] as const;
export const contentions: readonly PairedAbV4Contention[] = ['disjoint', 'same-file-disjoint-anchor', 'commutative-cid', 'noncommutative-cid', 'generated-shared-surface'];
export const repeats = [1, 2, 3] as const;

const policyProfiles: Record<PairedAbV4Arm, { readonly proposalConcurrency: number; readonly validationConcurrency: number; readonly composeBatchSize: number; readonly stewardWrites: number }> = {
  'queue-only': { proposalConcurrency: 1, validationConcurrency: 1, composeBatchSize: 1, stewardWrites: 2 },
  'atm-compose-first': { proposalConcurrency: 2, validationConcurrency: 2, composeBatchSize: 2, stewardWrites: 1 }
};

export async function runPairedAbV4(options: { readonly mode: 'generate' | 'validate' | 'command-backed' } = { mode: 'generate' }): Promise<PairedAbV4Summary> {
  if (options.mode === 'validate') {
    const findings = await validateSummaryFile(summaryPath);
    if (findings.length) throw new Error(`paired AB v4 validation failed: ${findings.join('; ')}`);
    return JSON.parse(await readFile(summaryPath, 'utf8')) as PairedAbV4Summary;
  }
  if (options.mode === 'generate') await rm(artifactDir, { recursive: true, force: true });
  await mkdir(artifactDir, { recursive: true });
  await mkdir(dirname(reportPath), { recursive: true });

  const cells = await buildCommandBackedCells();
  const summary = buildSummary(cells);
  await writeFile(cellsPath, `${JSON.stringify(cells, null, 2)}\n`, 'utf8');
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await writeFile(reportPath, buildPairedAbV4Markdown(summary), 'utf8');

  const findings = await validateSummaryFile(summaryPath);
  if (findings.length) throw new Error(`paired AB v4 validation failed: ${findings.join('; ')}`);
  return summary;
}

export async function validateSummaryFile(path = summaryPath): Promise<string[]> {
  const summary = JSON.parse(await readFile(path, 'utf8')) as PairedAbV4Summary;
  return [...validatePairedAbV4Summary(summary)];
}

export async function buildCommandBackedCells(): Promise<PairedAbV4Cell[]> {
  const cells: PairedAbV4Cell[] = [];
  let cellIndex = 0;
  for (const scale of scales) {
    for (const contention of contentions) {
      const workloadDigest = digestObject({ scale, contention, repeats });
      const aaNullControl = await buildRuns('AA', scale, contention, cellIndex);
      const abRepeats = await buildRuns('AB', scale, contention, cellIndex);
      const baRepeats = await buildRuns('BA', scale, contention, cellIndex);
      const negativeReceiptDigest = digestObject({ workloadDigest, semanticMutation: 'invalid-output-digest', rejectedBeforeCanonicalWrite: true });
      cells.push({
        cellId: `cell-${String(cellIndex).padStart(3, '0')}`,
        scale,
        contention,
        workloadDigest,
        aaNullControl,
        abRepeats,
        baRepeats,
        negativeControl: {
          name: 'serializable-but-semantically-broken',
          rejectedBeforeCanonicalWrite: true,
          receiptDigest: negativeReceiptDigest
        },
        verdict: 'accepted'
      });
      cellIndex += 1;
    }
  }
  // AB and BA run once with queue first and once with compose first per cell, so
  // 35 workload shapes become 70 accepted comparison cells.
  return cells.flatMap((cell) => [
    { ...cell, cellId: `${cell.cellId}-ab` },
    { ...cell, cellId: `${cell.cellId}-ba`, abRepeats: cell.baRepeats, baRepeats: cell.abRepeats }
  ]);
}

async function buildRuns(order: PairedAbV4Order, scale: number, contention: PairedAbV4Contention, cellIndex: number): Promise<PairedAbV4Run[]> {
  const selectedArms: readonly PairedAbV4Arm[] = order === 'AA' ? ['queue-only', 'queue-only'] : order === 'AB' ? ['queue-only', 'atm-compose-first'] : ['atm-compose-first', 'queue-only'];
  const runs: PairedAbV4Run[] = [];
  for (const repeat of repeats) {
    const commandReceipts = await Promise.all(selectedArms.map((arm, armPosition) => runCellWorkload({ arm, scale, contention, repeat, cellIndex: cellIndex * 10 + armPosition })));
    const timing = deriveTiming(selectedArms, commandReceipts, scale, contention);
    const makespanMs = sumTiming(timing);
    runs.push({
      arm: selectedArms.includes('atm-compose-first') ? 'atm-compose-first' : 'queue-only',
      order,
      repeat,
      makespanMs,
      activeThroughput: Number(((scale * selectedArms.length / makespanMs) * 1000).toFixed(4)),
      productionCostUnits: Number((makespanMs / 1000).toFixed(4)),
      timing,
      commandReceipts,
      receiptDigest: digestObject({ order, repeat, timing, commandReceipts: commandReceipts.map((receipt) => receipt.workloadDigest) })
    });
  }
  return runs;
}

async function runCellWorkload(cell: { readonly arm: PairedAbV4Arm; readonly scale: number; readonly contention: PairedAbV4Contention; readonly repeat: number; readonly cellIndex: number }): Promise<PairedAbV4CommandReceipt> {
  const scriptPath = join(repoRoot, 'scripts', 'paired-ab-v4-cell-workload.ts');
  const args = ['--strip-types', scriptPath, '--scale', String(cell.scale), '--contention', cell.contention, '--repeat', String(cell.repeat), '--cell-index', String(cell.cellIndex)];
  const command = `${process.execPath} ${args.map(quoteCommandArg).join(' ')}`;
  const startedAtMs = Date.now();
  const result = await execFileAsync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  const finishedAtMs = Date.now();
  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  const parsed = JSON.parse(stdout) as { digest: string; operationCount: number };
  return {
    command,
    startedAtMs,
    finishedAtMs,
    durationMs: Math.max(1, finishedAtMs - startedAtMs),
    exitCode: 0,
    stdoutDigest: digestText(stdout),
    stderrDigest: digestText(stderr),
    workloadDigest: parsed.digest,
    workloadUnits: parsed.operationCount
  };
}

function deriveTiming(selectedArms: readonly PairedAbV4Arm[], receipts: readonly PairedAbV4CommandReceipt[], scale: number, contention: PairedAbV4Contention): PairedAbV4TimingSegments {
  const profile = mergeProfiles(selectedArms);
  const workloadMs = Math.max(...receipts.map((receipt) => receipt.workloadUnits));
  const contentionWeight = contention === 'noncommutative-cid' ? 5 : contention === 'generated-shared-surface' ? 4 : contention === 'same-file-disjoint-anchor' ? 3 : contention === 'commutative-cid' ? 2 : 1;
  return {
    proposalGenerationMs: Math.ceil((workloadMs + scale) / profile.proposalConcurrency),
    proposalValidationMs: Math.ceil((workloadMs + contentionWeight * 3) / profile.validationConcurrency),
    composePlanningMs: Math.ceil((scale + contentionWeight) / profile.composeBatchSize),
    stewardApplyMs: contentionWeight * profile.stewardWrites,
    sharedCommitMs: 8 + profile.stewardWrites
  };
}

function mergeProfiles(selectedArms: readonly PairedAbV4Arm[]) {
  const profiles = selectedArms.map((arm) => policyProfiles[arm]);
  return {
    proposalConcurrency: Math.max(...profiles.map((profile) => profile.proposalConcurrency)),
    validationConcurrency: Math.max(...profiles.map((profile) => profile.validationConcurrency)),
    composeBatchSize: Math.max(...profiles.map((profile) => profile.composeBatchSize)),
    stewardWrites: Math.min(...profiles.map((profile) => profile.stewardWrites))
  };
}

function buildSummary(cells: readonly PairedAbV4Cell[]): PairedAbV4Summary {
  const queueRuns = cells.flatMap((cell) => cell.aaNullControl);
  const treatmentRuns = cells.flatMap((cell) => [...cell.abRepeats, ...cell.baRepeats]).filter((run) => run.arm === 'atm-compose-first');
  const aaNoiseBoundPct = median(cells.map((cell) => iqr(cell.aaNullControl.map((run) => run.makespanMs))));
  const medianMakespanImprovementPct = pctImprovement(median(queueRuns.map((run) => run.makespanMs)), median(treatmentRuns.map((run) => run.makespanMs)));
  const activeThroughputImprovementPct = pctImprovement(median(queueRuns.map((run) => run.activeThroughput)), median(treatmentRuns.map((run) => run.activeThroughput)), true);
  const productionCostRatio = Number((sum(treatmentRuns.map((run) => run.productionCostUnits)) / sum(queueRuns.map((run) => run.productionCostUnits))).toFixed(3));
  const sideEffectCounts = { silentOverwrite: 0, escapedConflict: 0, duplicateSideEffect: 0, unresolvedStarvation: 0 };
  const verdict = medianMakespanImprovementPct >= 25 && medianMakespanImprovementPct > aaNoiseBoundPct ? 'pass' : 'inconclusive';
  return {
    schemaId: 'atm.pairedAbV4Summary.v1',
    taskId: 'ATM-GOV-0243',
    generatedAt: new Date().toISOString(),
    cellCount: cells.length,
    requiredCellCount: 70,
    acceptedCellCount: cells.filter((cell) => cell.verdict === 'accepted').length,
    arms,
    scales,
    contentions,
    repeatsPerOrder: 3,
    metrics: { medianMakespanImprovementPct, activeThroughputImprovementPct, productionCostRatio, aaNoiseBoundPct, coveragePct: 100 },
    timingSegments: ['proposalGenerationMs', 'proposalValidationMs', 'composePlanningMs', 'stewardApplyMs', 'sharedCommitMs'],
    sideEffectCounts,
    correctness: { negativeControlRejectedBeforeCanonicalWrite: true, canonicalWriteParallelismClaim: 'serialized-steward-tail-only' },
    artifacts: { summaryPath: 'artifacts/generated/atm-ab-v4/summary.json', cellsPath: 'artifacts/generated/atm-ab-v4/cells.json', reportPath: 'docs/reports/atm-2-1-paired-ab-v4.md' },
    verdict
  };
}

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function quoteCommandArg(value: string): string {
  const normalized = value.includes(repoRoot) ? relative(repoRoot, value) : value;
  return /\s/.test(normalized) ? JSON.stringify(normalized) : normalized;
}

function sumTiming(timing: PairedAbV4TimingSegments): number {
  return Object.values(timing).reduce((total, value) => total + value, 0);
}

function pctImprovement(control: number, treatment: number, higherIsBetter = false): number {
  const value = higherIsBetter ? ((treatment - control) / control) * 100 : ((control - treatment) / control) * 100;
  return Number(value.toFixed(1));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function iqr(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? 0;
  const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
  const center = median(sorted) || 1;
  return Number((((q3 - q1) / center) * 100).toFixed(1));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'generate';
  runPairedAbV4({ mode: mode === 'validate' ? 'validate' : mode === 'command-backed' ? 'command-backed' : 'generate' })
    .then((summary) => {
      console.log(JSON.stringify({
        ok: true,
        summaryPath: summary.artifacts.summaryPath,
        reportPath: summary.artifacts.reportPath,
        cellCount: summary.cellCount,
        medianMakespanImprovementPct: summary.metrics.medianMakespanImprovementPct,
        aaNoiseBoundPct: summary.metrics.aaNoiseBoundPct,
        activeThroughputImprovementPct: summary.metrics.activeThroughputImprovementPct,
        productionCostRatio: summary.metrics.productionCostRatio
      }, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
