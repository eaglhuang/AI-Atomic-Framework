// Export protected-branch CI attempts from GitHub into atm.githubCiAttemptExport.v1,
// the input of scripts/collect-ci-burn-in-evidence.ts. Requires an authenticated `gh`
// (set ATM_GH_BIN when gh is not on the PATH seen by node).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { CiAttempt, CiAttemptExport } from './collect-ci-burn-in-evidence.ts';

export interface GhRun {
  databaseId: number;
  attempt: number;
  status: string;
  conclusion: string | null;
  createdAt: string;
  headSha: string;
  headBranch: string;
  event: string;
  displayTitle: string;
}

export interface GhJob {
  id: number;
  name: string;
  conclusion: string | null;
  html_url: string;
  started_at: string | null;
  completed_at: string | null;
  /** GitHub job steps are required for the burn-in collector's coverage gate. */
  steps?: Array<{
    name: string;
    status: string;
    conclusion: string | null;
  }>;
}

export interface ExportInput {
  repository: string;
  protectedBranch: string;
  runs: GhRun[];
  /** Keyed by `${runId}#${attempt}`. */
  jobsByRunAttempt: Map<string, GhJob[]>;
  productJobName?: string;
  failureDispositions?: unknown[];
}

export type AttemptExportWithDrops = CiAttemptExport & { droppedRuns: Array<{ runId: number; reason: string }> };

const PROTECTED_EVENTS = new Set(['push', 'workflow_dispatch', 'schedule']);

export function buildAttemptExport(input: ExportInput): AttemptExportWithDrops {
  const productJobName = input.productJobName ?? 'Product CI';
  const attempts: CiAttempt[] = [];
  const droppedRuns: AttemptExportWithDrops['droppedRuns'] = [];
  const ordered = [...input.runs].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.databaseId - right.databaseId);
  for (const run of ordered) {
    if (run.status !== 'completed') {
      droppedRuns.push({ runId: run.databaseId, reason: 'not-completed' });
      continue;
    }
    if (!PROTECTED_EVENTS.has(run.event)) {
      droppedRuns.push({ runId: run.databaseId, reason: `unsupported-event:${run.event}` });
      continue;
    }
    const latestAttempt = Math.max(1, run.attempt || 1);
    for (let runAttempt = 1; runAttempt <= latestAttempt; runAttempt += 1) {
      const jobs = input.jobsByRunAttempt.get(`${run.databaseId}#${runAttempt}`);
      if (!jobs) throw new Error(`run ${run.databaseId} attempt ${runAttempt} has no job data`);
      const product = jobs.find((job) => job.name === productJobName);
      const productConclusion = product ? product.conclusion ?? 'unknown' : null;
      const outcome = productConclusion ?? (runAttempt === latestAttempt ? run.conclusion ?? 'unknown' : 'unknown');
      const workflowConclusion = runAttempt === latestAttempt ? run.conclusion ?? 'unknown' : outcome;
      attempts.push({
        runId: run.databaseId,
        runAttempt,
        status: 'completed',
        conclusion: workflowConclusion,
        headSha: run.headSha,
        headBranch: run.headBranch,
        event: run.event as CiAttempt['event'],
        createdAt: run.createdAt,
        attemptStartedAt: product?.started_at ?? run.createdAt,
        attemptCompletedAt: product?.completed_at ?? run.createdAt,
        ...(product ? {
          productCi: {
            conclusion: productConclusion!,
            job: {
              jobId: product.id,
              jobName: product.name,
              jobUrl: product.html_url,
              ...(product.steps ? { steps: product.steps } : {}),
            },
          },
        } : {}),
        displayTitle: run.displayTitle,
        workflowName: run.displayTitle,
        // Out-of-scope runs are judged by the workflow conclusion, in-scope runs by
        // the Product CI job, so either failing needs a class.
        failureClass: outcome === 'success' && workflowConclusion === 'success' ? null : 'unknown-failure',
      });
    }
  }
  return {
    schemaId: 'atm.githubCiAttemptExport.v1',
    repository: input.repository,
    protectedBranch: input.protectedBranch,
    attempts,
    ...(input.failureDispositions ? { failureDispositions: input.failureDispositions as CiAttemptExport['failureDispositions'] } : {}),
    droppedRuns,
  };
}

function gh(args: string[]): string {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return execFileSync(process.env.ATM_GH_BIN || 'gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
    } catch (error) {
      lastError = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 2000);
    }
  }
  throw new Error(`gh ${args.slice(0, 3).join(' ')} failed after 3 attempts: ${String(lastError).slice(0, 300)}`);
}

function option(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repository = option(args, '--repo');
  const since = option(args, '--since');
  const output = option(args, '--output');
  if (!repository || !since || !output) {
    console.error('usage: --repo <owner/name> --since <YYYY-MM-DD> --output <export.json> [--branch main] [--workflow ci.yml] [--product-job "Product CI"] [--dispositions <file.json>]');
    process.exitCode = 2;
    return;
  }
  const branch = option(args, '--branch', 'main')!;
  const workflow = option(args, '--workflow', 'ci.yml')!;
  const runs = JSON.parse(gh(['run', 'list', '--repo', repository, '--branch', branch, '--workflow', workflow, '--created', `>=${since}`,
    '--limit', '5000', '--json', 'databaseId,attempt,status,conclusion,createdAt,headSha,headBranch,event,displayTitle'])) as GhRun[];
  const jobsByRunAttempt = new Map<string, GhJob[]>();
  for (const run of runs) {
    if (run.status !== 'completed') continue;
    for (let attempt = 1; attempt <= Math.max(1, run.attempt || 1); attempt += 1) {
      const body = JSON.parse(gh(['api', `repos/${repository}/actions/runs/${run.databaseId}/attempts/${attempt}/jobs?per_page=100`])) as { jobs: GhJob[] };
      jobsByRunAttempt.set(`${run.databaseId}#${attempt}`, body.jobs);
    }
  }
  const dispositionsPath = option(args, '--dispositions');
  const failureDispositions = dispositionsPath ? JSON.parse(readFileSync(dispositionsPath, 'utf8')) as unknown[] : undefined;
  const exported = buildAttemptExport({ repository, protectedBranch: branch, runs, jobsByRunAttempt, productJobName: option(args, '--product-job'), failureDispositions });
  writeFileSync(output, `${JSON.stringify(exported, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, output, runs: runs.length, attempts: exported.attempts.length, droppedRuns: exported.droppedRuns.length }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
