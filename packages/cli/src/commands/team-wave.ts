// TASK-MAO-0024: `team wave` CLI surface. Computes a Team Agents Wave Mode plan
// from declared task-ledger metadata using the broker wave planner. This is the
// planning/dispatch entry point; the broker admission deep-check (TASK-MAO-0026)
// and runtime wave record (TASK-MAO-0027) layer on top of this surface.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message } from './shared.ts';
import {
  planWaves,
  type WaveCandidateCard,
  type WavePlan
} from '../../../core/src/broker/team-wave-planner.ts';

interface LedgerTask {
  readonly workItemId: string;
  readonly status?: string;
  readonly dependencies?: readonly string[];
  readonly scopePaths?: readonly string[];
  readonly deliverables?: readonly string[];
  readonly validators?: readonly string[];
  readonly targetRepo?: string | null;
  readonly closureAuthority?: string | null;
  readonly atomizationImpact?: { readonly ownerAtomOrMap?: string | null };
}

const TASKS_DIR = '.atm/history/tasks';

function readLedgerTask(cwd: string, taskId: string): LedgerTask | null {
  const file = path.join(cwd, TASKS_DIR, `${taskId}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as LedgerTask;
  } catch {
    return null;
  }
}

function toCandidate(task: LedgerTask): WaveCandidateCard {
  return {
    taskId: task.workItemId,
    dependencies: task.dependencies ?? [],
    scopePaths: task.scopePaths ?? [],
    deliverables: task.deliverables ?? [],
    validators: task.validators ?? [],
    targetRepo: task.targetRepo ?? null,
    closureAuthority: task.closureAuthority ?? null,
    ownerAtomOrMap: task.atomizationImpact?.ownerAtomOrMap ?? null
  };
}

function closedTaskIds(cwd: string): readonly string[] {
  const dir = path.join(cwd, TASKS_DIR);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue;
    try {
      const t = JSON.parse(readFileSync(path.join(dir, entry), 'utf8')) as LedgerTask;
      if ((t.status ?? '').toLowerCase() === 'done') out.push(t.workItemId);
    } catch {
      // skip unreadable ledger files
    }
  }
  return out;
}

/**
 * Build a wave plan for an explicit set of task ids, reading their declared
 * metadata from the ledger. Append-safe paths default to the coverage map,
 * which uses an owner-shard / union-merge strategy.
 */
export function buildWavePlanFromTaskIds(
  cwd: string,
  taskIds: readonly string[],
  appendSafePaths: readonly string[] = ['atomic_workbench/atomization-coverage/path-to-atom-map.json']
): { readonly plan: WavePlan; readonly missing: readonly string[] } {
  const cards: WaveCandidateCard[] = [];
  const missing: string[] = [];
  for (const id of taskIds) {
    const task = readLedgerTask(cwd, id);
    if (!task) {
      missing.push(id);
      continue;
    }
    cards.push(toCandidate(task));
  }
  const plan = planWaves({ cards, closedTaskIds: closedTaskIds(cwd), appendSafePaths });
  return { plan, missing };
}

/**
 * Handle `team wave plan --tasks <csv>`. Delegated to from the `team` command so
 * no new top-level command registration is required.
 */
export function runTeamWave(argv: readonly string[], cwd: string) {
  const action = String(argv[0] ?? 'plan').toLowerCase();
  if (action !== 'plan') {
    throw new CliError('ATM_TEAM_WAVE_USAGE', 'team wave supports: plan', { exitCode: 2 });
  }
  // Tasks are passed as a positional CSV (`team wave plan TASK-A,TASK-B`) so the
  // shared `team` command spec does not need a new `--tasks` flag. A `--tasks`
  // form is also accepted when present for convenience.
  const tasksFlagIndex = argv.indexOf('--tasks');
  const tasksCsv =
    tasksFlagIndex >= 0 ? String(argv[tasksFlagIndex + 1] ?? '') : String(argv[1] ?? '');
  const taskIds = tasksCsv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (taskIds.length === 0) {
    throw new CliError('ATM_TEAM_WAVE_TASKS_REQUIRED', 'team wave plan requires --tasks <csv>.', {
      exitCode: 2
    });
  }

  const { plan, missing } = buildWavePlanFromTaskIds(cwd, taskIds);
  const ok = missing.length === 0;
  return makeResult({
    ok,
    command: 'team',
    cwd,
    messages: [
      message(
        ok ? 'info' : 'error',
        ok ? 'ATM_TEAM_WAVE_PLANNED' : 'ATM_TEAM_WAVE_MISSING_TASKS',
        ok
          ? `Planned ${plan.waves.length} wave(s) for ${plan.totalCards} card(s).`
          : `Cannot plan: ${missing.length} task id(s) not found in ledger.`,
        { waveCount: plan.waves.length, unschedulable: plan.unschedulable.length, missing }
      )
    ],
    evidence: { wavePlan: plan, missing }
  });
}
