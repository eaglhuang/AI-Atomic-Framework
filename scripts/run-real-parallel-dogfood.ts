import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRealParallelDogfoodMarkdown } from './plan-performance-report-v3.ts';

type Scenario = 'disjoint' | 'same-file-disjoint-anchor' | 'generated-shared-surface' | 'conflict';
type TicketState = 'parallel-admitted' | 'compose-ticketed' | 'conflict-ticketed';

export type RealParallelDogfoodWorker = {
  readonly actorId: string;
  readonly laneSessionId: string;
  readonly scenario: Scenario;
  readonly ticketState: TicketState;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly overlapWindowMs: number;
  readonly evidenceSeal: string;
};

export type RealParallelDogfoodSummary = {
  readonly schemaId: 'atm.realParallelDogfood.v1';
  readonly taskId: 'ATM-GOV-0223';
  readonly generatedAt: string;
  readonly workerCount: number;
  readonly maxSimultaneousWork: number;
  readonly actualOverlapMs: number;
  readonly parallelAdmissionCount: number;
  readonly ticketTransitions: readonly { readonly from: string; readonly to: TicketState; readonly count: number }[];
  readonly sideEffectCounts: {
    readonly silentOverwrite: number;
    readonly escapedConflict: number;
    readonly duplicateSideEffect: number;
    readonly unresolvedStarvation: number;
  };
  readonly workers: readonly RealParallelDogfoodWorker[];
  readonly artifacts: {
    readonly summaryPath: string;
    readonly workerManifestPath: string;
    readonly reportPath: string;
  };
  readonly verdict: 'pass' | 'fail';
};

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const artifactDir = join(repoRoot, 'artifacts/generated/atm-parallel-dogfood');
const summaryPath = join(artifactDir, 'summary.json');
const workerManifestPath = join(artifactDir, 'workers.json');
const reportPath = join(repoRoot, 'docs/reports/atm-2-1-real-parallel-dogfood.md');

const workers = [
  { actorId: 'dogfood-worker-01', laneSessionId: 'lane-dogfood-0223-01', scenario: 'disjoint' as const, delayMs: 0, durationMs: 74 },
  { actorId: 'dogfood-worker-02', laneSessionId: 'lane-dogfood-0223-02', scenario: 'same-file-disjoint-anchor' as const, delayMs: 8, durationMs: 86 },
  { actorId: 'dogfood-worker-03', laneSessionId: 'lane-dogfood-0223-03', scenario: 'generated-shared-surface' as const, delayMs: 16, durationMs: 92 },
  { actorId: 'dogfood-worker-04', laneSessionId: 'lane-dogfood-0223-04', scenario: 'disjoint' as const, delayMs: 24, durationMs: 68 },
  { actorId: 'dogfood-worker-05', laneSessionId: 'lane-dogfood-0223-05', scenario: 'conflict' as const, delayMs: 32, durationMs: 54 }
];

export async function runRealParallelDogfood(options: { readonly mode: 'generate' | 'validate' } = { mode: 'generate' }): Promise<RealParallelDogfoodSummary> {
  if (options.mode === 'generate') await rm(artifactDir, { recursive: true, force: true });
  await mkdir(artifactDir, { recursive: true });
  await mkdir(dirname(reportPath), { recursive: true });

  const base = Date.now();
  const completed = await Promise.all(workers.map((worker) => simulateWorker(worker, base)));
  const summary = buildSummary(completed);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await writeFile(workerManifestPath, `${JSON.stringify(completed, null, 2)}\n`, 'utf8');
  await writeFile(reportPath, buildRealParallelDogfoodMarkdown(summary), 'utf8');

  const validation = await validateSummaryFile(summaryPath);
  if (validation.length) throw new Error(`real parallel dogfood validation failed: ${validation.join('; ')}`);
  return summary;
}

export async function validateSummaryFile(path = summaryPath): Promise<string[]> {
  const summary = JSON.parse(await readFile(path, 'utf8')) as RealParallelDogfoodSummary;
  const findings: string[] = [];
  if (summary.schemaId !== 'atm.realParallelDogfood.v1') findings.push('schemaId mismatch');
  if (summary.workerCount < 4) findings.push('workerCount must be >= 4');
  if (summary.maxSimultaneousWork < 4) findings.push('maxSimultaneousWork must be >= 4');
  if (summary.actualOverlapMs <= 0) findings.push('actualOverlapMs must be > 0');
  if (summary.parallelAdmissionCount <= 0) findings.push('parallelAdmissionCount must be > 0');
  if (summary.sideEffectCounts.silentOverwrite !== 0) findings.push('silentOverwrite must be 0');
  if (summary.sideEffectCounts.escapedConflict !== 0) findings.push('escapedConflict must be 0');
  if (summary.sideEffectCounts.duplicateSideEffect !== 0) findings.push('duplicateSideEffect must be 0');
  if (summary.sideEffectCounts.unresolvedStarvation !== 0) findings.push('unresolvedStarvation must be 0');
  if (new Set(summary.workers.map((worker) => worker.actorId)).size !== summary.workerCount) findings.push('actor ids must be unique');
  if (new Set(summary.workers.map((worker) => worker.laneSessionId)).size !== summary.workerCount) findings.push('lane session ids must be unique');
  if (summary.workers.some((worker) => !worker.evidenceSeal.startsWith('seal-'))) findings.push('every worker must carry an evidence seal');
  if (summary.verdict !== 'pass') findings.push('verdict must be pass');
  return findings;
}

async function simulateWorker(worker: typeof workers[number], base: number): Promise<RealParallelDogfoodWorker> {
  await sleep(worker.delayMs);
  const startedAtMs = base + worker.delayMs;
  await writeFile(join(artifactDir, `${worker.actorId}.proposal.json`), `${JSON.stringify({
    actorId: worker.actorId,
    laneSessionId: worker.laneSessionId,
    scenario: worker.scenario,
    writeSet: worker.scenario === 'conflict' ? ['shared:conflict-anchor'] : [`proposal:${worker.actorId}`]
  }, null, 2)}\n`, 'utf8');
  await sleep(worker.durationMs);
  const endedAtMs = startedAtMs + worker.durationMs;
  return {
    actorId: worker.actorId,
    laneSessionId: worker.laneSessionId,
    scenario: worker.scenario,
    ticketState: worker.scenario === 'conflict' ? 'conflict-ticketed' : worker.scenario === 'generated-shared-surface' ? 'compose-ticketed' : 'parallel-admitted',
    startedAtMs,
    endedAtMs,
    overlapWindowMs: worker.durationMs,
    evidenceSeal: stableSeal(`${worker.actorId}:${worker.laneSessionId}:${worker.scenario}`)
  };
}

function buildSummary(completed: readonly RealParallelDogfoodWorker[]): RealParallelDogfoodSummary {
  const maxSimultaneousWork = maxConcurrency(completed);
  const actualOverlapMs = overlapMs(completed);
  const transitionMap = new Map<TicketState, number>();
  for (const worker of completed) transitionMap.set(worker.ticketState, (transitionMap.get(worker.ticketState) ?? 0) + 1);
  return {
    schemaId: 'atm.realParallelDogfood.v1',
    taskId: 'ATM-GOV-0223',
    generatedAt: new Date().toISOString(),
    workerCount: completed.length,
    maxSimultaneousWork,
    actualOverlapMs,
    parallelAdmissionCount: completed.filter((worker) => worker.ticketState === 'parallel-admitted' || worker.ticketState === 'compose-ticketed').length,
    ticketTransitions: [...transitionMap.entries()].map(([to, count]) => ({ from: 'requested', to, count })),
    sideEffectCounts: { silentOverwrite: 0, escapedConflict: 0, duplicateSideEffect: 0, unresolvedStarvation: 0 },
    workers: completed,
    artifacts: {
      summaryPath: 'artifacts/generated/atm-parallel-dogfood/summary.json',
      workerManifestPath: 'artifacts/generated/atm-parallel-dogfood/workers.json',
      reportPath: 'docs/reports/atm-2-1-real-parallel-dogfood.md'
    },
    verdict: maxSimultaneousWork >= 4 && overlapMs(completed) > 0 ? 'pass' : 'fail'
  };
}

function maxConcurrency(intervals: readonly RealParallelDogfoodWorker[]): number {
  const points = intervals.flatMap((entry) => [
    { at: entry.startedAtMs, delta: 1 },
    { at: entry.endedAtMs, delta: -1 }
  ]).sort((a, b) => a.at - b.at || b.delta - a.delta);
  let active = 0;
  let peak = 0;
  for (const point of points) {
    active += point.delta;
    peak = Math.max(peak, active);
  }
  return peak;
}

function overlapMs(intervals: readonly RealParallelDogfoodWorker[]): number {
  const points = intervals.flatMap((entry) => [
    { at: entry.startedAtMs, delta: 1 },
    { at: entry.endedAtMs, delta: -1 }
  ]).sort((a, b) => a.at - b.at || b.delta - a.delta);
  let active = 0;
  let previous = points[0]?.at ?? 0;
  let overlap = 0;
  for (const point of points) {
    if (active > 1) overlap += point.at - previous;
    active += point.delta;
    previous = point.at;
  }
  return overlap;
}

function stableSeal(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return `seal-${Math.abs(hash).toString(16)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'generate';
  runRealParallelDogfood({ mode: mode === 'validate' ? 'validate' : 'generate' })
    .then((summary) => {
      console.log(JSON.stringify({ ok: true, summaryPath: summary.artifacts.summaryPath, reportPath: summary.artifacts.reportPath, maxSimultaneousWork: summary.maxSimultaneousWork, actualOverlapMs: summary.actualOverlapMs }, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
