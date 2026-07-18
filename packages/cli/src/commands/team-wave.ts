// TASK-MAO-0024: `team wave` CLI surface. Computes a Team Agents Wave Mode plan
// from declared task-ledger metadata using the broker wave planner. This is the
// planning/dispatch entry point; the broker admission deep-check (TASK-MAO-0026)
// and runtime wave record (TASK-MAO-0027) layer on top of this surface.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message } from './shared.ts';
import { validateStrictPathHeuristic } from './tasks/task-import-validators.ts';
import { createTeamShadowWorkspaceProviderPlan } from './team/shadow-workspace.ts';
import { findActiveTaskQueue, type TaskDirectionTask } from './task-direction.ts';
import { readActiveBatchRun, type BatchRunRecord } from './work-channels.ts';
import {
  planWaves,
  type WaveCandidateCard,
  type WavePlan
} from '../../../core/src/broker/team-wave-planner.ts';
import { admitWave, type WaveAdmissionDecision } from '../../../core/src/broker/team-wave-admission.ts';
import { createTeamWaveEnvelope, type TeamWaveEnvelope } from '../../../core/src/broker/team-wave-envelope.ts';
import { createWaveManifest, evaluateWaveEligibility, type WaveManifest, type WaveManifestTask } from '../../../core/src/broker/wave-manifest.ts';
import { effectiveExecutionState, validateWorkerReport, type TeamWorkerReport } from '../../../core/src/broker/team-worker-report.ts';

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
    scopePaths: normalizeTaskPathArray(task.scopePaths),
    deliverables: normalizeTaskPathArray(task.deliverables),
    validators: task.validators ?? [],
    targetRepo: task.targetRepo ?? null,
    closureAuthority: task.closureAuthority ?? null,
    ownerAtomOrMap: task.atomizationImpact?.ownerAtomOrMap ?? null
  };
}

function normalizeTaskPathArray(value: unknown): string[] {
  return uniqueStrings(
    normalizeStringArray(value)
      .map((entry) => entry.replace(/\\/g, '/').trim().replace(/^\.\//, ''))
      .filter((entry) => Boolean(entry) && validateStrictPathHeuristic(entry) === null)
  );
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
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

const WAVE_RUNTIME_DIR = '.atm/runtime/team-waves';
type WaveExecutor = 'auto' | 'local-lanes' | 'editor-subagents' | 'team-agents' | 'manual';

export interface TeamWaveRuntimeLane {
  readonly taskId: string;
  readonly laneSessionId: string;
  readonly workspace: ReturnType<typeof createTeamShadowWorkspaceProviderPlan>;
  readonly workerCanCommitOrClose: false;
  readonly allowedReturnSchemas: readonly ['atm.patchEnvelope.v1', 'atm.teamWorkerReport.v1'];
}

export interface TeamWaveRuntimeRecord {
  readonly schemaId: 'atm.teamWaveRuntime.v1';
  readonly specVersion: '0.1.0';
  readonly waveId: string;
  readonly batchId: string;
  readonly executor: WaveExecutor;
  readonly coordinatorActorId: string;
  readonly taskIds: readonly string[];
  readonly manifest: WaveManifest;
  readonly lanes: readonly TeamWaveRuntimeLane[];
  readonly workerReports: readonly TeamWorkerReport[];
  readonly acceptedTaskIds: readonly string[];
  readonly deferredTaskIds: readonly string[];
  readonly outOfScopeFindings: readonly { readonly taskId: string; readonly files: readonly string[] }[];
  readonly resultState: 'ready-for-write' | 'needs-review' | 'serial-fallback';
  readonly writesPerformed: false;
  readonly createdAt: string;
}

// TASK-MAO-0031: coordinator-only git / closeout guard. Wave Mode roles other
// than the coordinator must never perform git writes or drive task closeout;
// the existing hooks, batch checkpoint, and taskflow close remain the lifecycle
// authority. This guard is a pure check the dispatch surface and tests use to
// fail closed before any write-capable action.
export type WaveRole = 'coordinator' | 'worker' | 'validator' | 'reviewer';
export type WavePrivilegedAction = 'git-write' | 'task-closeout' | 'checkpoint';

export interface CoordinatorGuardResult {
  readonly allowed: boolean;
  readonly reason: string;
}

export function assertCoordinatorOnly(
  role: WaveRole,
  action: WavePrivilegedAction
): CoordinatorGuardResult {
  if (role === 'coordinator') {
    return { allowed: true, reason: `coordinator may perform ${action}` };
  }
  return {
    allowed: false,
    reason: `role ${role} may not perform ${action}; Wave Mode reserves git writes and closeout for the coordinator`
  };
}

/**
 * Build admission decision + per-wave envelopes for the first planned wave.
 * TASK-MAO-0027: this is the dispatch surface that turns a metadata wave plan
 * into a coordinator-owned runtime record. Lifecycle authority remains with
 * batch checkpoint / taskflow close — this only records intent.
 */
export function buildWaveRuntimeRecord(
  cwd: string,
  taskIds: readonly string[],
  coordinatorActorId: string
): {
  readonly plan: WavePlan;
  readonly admission: WaveAdmissionDecision;
  readonly envelope: TeamWaveEnvelope | null;
  readonly missing: readonly string[];
} {
  const { plan, missing } = buildWavePlanFromTaskIds(cwd, taskIds);
  const firstWave = plan.waves[0];
  const cardsById = new Map<string, WaveCandidateCard>();
  for (const id of taskIds) {
    const task = readLedgerTask(cwd, id);
    if (task) cardsById.set(task.workItemId, toCandidate(task));
  }
  const members = (firstWave?.members ?? [])
    .map((m) => cardsById.get(m.taskId))
    .filter((c): c is WaveCandidateCard => Boolean(c))
    .map((card) => ({ card }));
  const admission = admitWave({ members, closedTaskIds: closedTaskIds(cwd) });

  let envelope: TeamWaveEnvelope | null = null;
  if (firstWave && admission.admitted.length > 0) {
    const admittedCards = admission.admitted
      .map((id) => cardsById.get(id))
      .filter((c): c is WaveCandidateCard => Boolean(c));
    envelope = createTeamWaveEnvelope({
      coordinatorActorId,
      targetRepo: admittedCards[0]?.targetRepo ?? null,
      closureAuthority: admittedCards[0]?.closureAuthority ?? null,
      waveIndex: firstWave.waveIndex,
      members: admittedCards.map((card) => ({
        taskId: card.taskId,
        workerActorId: null,
        scopePaths: card.scopePaths,
        deliverables: card.deliverables,
        patchEnvelopeId: null,
        executionState: 'not-started' as const
      }))
    });
  }
  return { plan, admission, envelope, missing };
}

export function buildManifestRuntimeRecordFromBatch(input: {
  readonly cwd: string;
  readonly batchId: string;
  readonly waveId: string;
  readonly executor: WaveExecutor;
  readonly coordinatorActorId: string;
  readonly workerReports?: readonly TeamWorkerReport[];
  readonly now?: string;
}): { readonly ok: boolean; readonly runtime: TeamWaveRuntimeRecord | null; readonly reason: string | null; readonly batchRun: BatchRunRecord | null } {
  const batchRun = readActiveBatchRun(input.cwd, { batchId: input.batchId });
  if (!batchRun) return { ok: false, runtime: null, reason: 'batch-not-found', batchRun: null };
  const queue = findActiveTaskQueue(input.cwd, batchRun.sourcePrompt, { batchId: batchRun.batchId });
  if (!queue) return { ok: false, runtime: null, reason: 'active-task-queue-not-found', batchRun };
  const selected = selectManifestTasksFromQueue(input.cwd, queue.tasks.slice(queue.currentIndex), input.waveId);
  if (selected.length === 0) return { ok: false, runtime: null, reason: 'wave-has-no-eligible-members', batchRun };
  const targetRepo = selected[0]?.targetRepo ?? batchRun.targetRepo ?? 'unknown';
  const manifest = createWaveManifest({
    waveId: input.waveId,
    batchRunId: batchRun.batchId,
    coordinatorActorId: input.coordinatorActorId,
    targetRepo,
    executor: input.executor,
    tasks: selected,
    sealedBaseSha: readGitHead(input.cwd),
    state: 'executing',
    now: input.now
  });
  const reports = input.workerReports ?? [];
  const outOfScopeFindings = buildOutOfScopeFindings(manifest, reports);
  const invalidReports = reports.filter((report) => !validateWorkerReport(report).ok).map((report) => report.taskId);
  const deferredTaskIds = reports
    .filter((report) => {
      const state = effectiveExecutionState(report);
      return state === 'partial' || state === 'blocked' || state === 'not-started';
    })
    .map((report) => report.taskId);
  const acceptedTaskIds = manifest.tasks
    .map((task) => task.taskId)
    .filter((taskId) => !deferredTaskIds.includes(taskId) && !invalidReports.includes(taskId));
  const resultState = outOfScopeFindings.length > 0 || invalidReports.length > 0
    ? 'needs-review'
    : acceptedTaskIds.length < 2
      ? 'serial-fallback'
      : 'ready-for-write';
  const runtime: TeamWaveRuntimeRecord = {
    schemaId: 'atm.teamWaveRuntime.v1',
    specVersion: '0.1.0',
    waveId: input.waveId,
    batchId: batchRun.batchId,
    executor: input.executor,
    coordinatorActorId: input.coordinatorActorId,
    taskIds: manifest.tasks.map((task) => task.taskId),
    manifest: { ...manifest, state: resultState === 'ready-for-write' ? 'ready-for-write' : resultState === 'needs-review' ? 'needs-review' : 'planned' },
    lanes: manifest.tasks.map((task, index) => ({
      taskId: task.taskId,
      laneSessionId: `lane-${input.waveId}-${String(index + 1).padStart(2, '0')}-${task.taskId.toLowerCase()}`,
      workspace: createTeamShadowWorkspaceProviderPlan({ baseCommit: manifest.sealedBaseSha ?? 'HEAD' }),
      workerCanCommitOrClose: false,
      allowedReturnSchemas: ['atm.patchEnvelope.v1', 'atm.teamWorkerReport.v1']
    })),
    workerReports: reports,
    acceptedTaskIds,
    deferredTaskIds,
    outOfScopeFindings,
    resultState,
    writesPerformed: false,
    createdAt: input.now ?? new Date().toISOString()
  };
  return { ok: resultState !== 'needs-review', runtime, reason: null, batchRun };
}

function selectManifestTasksFromQueue(cwd: string, tasks: readonly TaskDirectionTask[], waveId: string): readonly WaveManifestTask[] {
  const selected: WaveManifestTask[] = [];
  for (const task of tasks) {
    const validators = readTaskValidators(cwd, task.taskPath);
    if (validators.length === 0) continue;
    const candidate: WaveManifestTask = {
      taskId: task.workItemId,
      waveId,
      targetRepo: task.targetRepo ?? 'unknown',
      surfaceFamily: inferSurfaceFamily(task.scopePaths),
      scopePaths: task.scopePaths,
      validators,
      dependencyReady: task.dependencies.every((dependency) => readLedgerTask(cwd, dependency)?.status === 'done')
    };
    if (!candidate.dependencyReady) continue;
    if (!evaluateWaveEligibility([...selected, candidate]).ok) continue;
    selected.push(candidate);
    if (selected.length >= 4) break;
  }
  return selected;
}

function buildOutOfScopeFindings(manifest: WaveManifest, reports: readonly TeamWorkerReport[]) {
  const byTask = new Map(manifest.tasks.map((task) => [task.taskId, task]));
  return reports
    .map((report) => {
      const task = byTask.get(report.taskId);
      const files = task ? report.changedFiles.filter((file) => !pathAllowedByScope(file, task.scopePaths)) : report.changedFiles;
      return { taskId: report.taskId, files };
    })
    .filter((entry) => entry.files.length > 0);
}

function pathAllowedByScope(filePath: string, scopePaths: readonly string[]): boolean {
  const normalized = normalizeRepoPath(filePath);
  return scopePaths.some((scope) => {
    const allowed = normalizeRepoPath(scope);
    if (allowed.endsWith('/**')) return normalized.startsWith(allowed.slice(0, -3));
    return normalized === allowed || normalized.startsWith(`${allowed.replace(/\/$/, '')}/`);
  });
}

function readTaskValidators(cwd: string, taskPath: string): readonly string[] {
  const file = path.join(cwd, taskPath);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { validators?: unknown };
    return normalizeStringArray(parsed.validators);
  } catch {
    return [];
  }
}

function inferSurfaceFamily(scopePaths: readonly string[]): string {
  const lower = scopePaths.map((entry) => normalizeRepoPath(entry).toLowerCase());
  if (lower.some((entry) => entry.startsWith('packages/cli/'))) return 'cli';
  if (lower.some((entry) => entry.startsWith('packages/core/'))) return 'core';
  if (lower.some((entry) => entry.startsWith('scripts/'))) return 'scripts';
  if (lower.some((entry) => entry.startsWith('docs/') || entry.endsWith('.md'))) return 'docs';
  if (lower.some((entry) => entry.startsWith('.atm/'))) return 'ledger';
  return 'mixed';
}

function normalizeRepoPath(value: string): string {
  return value.replace(/\\/g, '/').trim().replace(/^\.\//, '');
}

function readGitHead(cwd: string): string | null {
  try {
    const head = readFileSync(path.join(cwd, '.git', 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref:')) {
      const ref = head.slice(5).trim();
      const refPath = path.join(cwd, '.git', ref);
      return existsSync(refPath) ? readFileSync(refPath, 'utf8').trim() : null;
    }
    return head || null;
  } catch {
    return null;
  }
}

function parseWaveOptions(argv: readonly string[]) {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? String(argv[index + 1] ?? '').trim() : '';
  };
  const reports: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--worker-report') reports.push(String(argv[index + 1] ?? '').trim());
  }
  return {
    batchId: value('--batch'),
    waveId: value('--wave'),
    executor: (value('--executor') || 'auto') as WaveExecutor,
    actorId: value('--actor') || String(process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? 'wave-coordinator'),
    workerReportPaths: reports.filter(Boolean)
  };
}

function readWorkerReports(paths: readonly string[]): readonly TeamWorkerReport[] {
  return paths.map((filePath) => JSON.parse(readFileSync(path.resolve(filePath), 'utf8')) as TeamWorkerReport);
}

/**
 * Handle `team wave <plan|dispatch> <csv>`. Delegated to from the `team` command
 * so no new top-level command registration is required.
 */
export function runTeamWave(argv: readonly string[], cwd: string) {
  const action = String(argv[0] ?? 'plan').toLowerCase();
  if (action !== 'plan' && action !== 'dispatch') {
    throw new CliError('ATM_TEAM_WAVE_USAGE', 'team wave supports: plan, dispatch', { exitCode: 2 });
  }
  const waveOptions = parseWaveOptions(argv);
  if (waveOptions.batchId || waveOptions.waveId) {
    if (!waveOptions.batchId || !waveOptions.waveId) {
      throw new CliError('ATM_TEAM_WAVE_MANIFEST_ARGS_REQUIRED', 'team wave manifest runtime requires both --batch <id> and --wave <id>.', { exitCode: 2 });
    }
    const record = buildManifestRuntimeRecordFromBatch({
      cwd,
      batchId: waveOptions.batchId,
      waveId: waveOptions.waveId,
      executor: waveOptions.executor,
      coordinatorActorId: waveOptions.actorId,
      workerReports: readWorkerReports(waveOptions.workerReportPaths)
    });
    const ok = Boolean(record.runtime) && record.ok;
    if (action === 'dispatch' && record.runtime) {
      const dir = path.join(cwd, WAVE_RUNTIME_DIR);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${record.runtime.waveId}.json`), `${JSON.stringify(record.runtime, null, 2)}\n`, 'utf8');
    }
    return makeResult({
      ok,
      command: 'team',
      cwd,
      messages: [
        message(
          ok ? 'info' : 'error',
          ok ? (action === 'dispatch' ? 'ATM_TEAM_WAVE_RUNTIME_DISPATCHED' : 'ATM_TEAM_WAVE_RUNTIME_PLANNED') : 'ATM_TEAM_WAVE_RUNTIME_NEEDS_REVIEW',
          ok ? `Team wave ${action} prepared executor-neutral runtime ${waveOptions.waveId}.` : `Team wave ${action} could not prepare a ready runtime: ${record.reason ?? record.runtime?.resultState ?? 'needs-review'}.`,
          { batchId: waveOptions.batchId, waveId: waveOptions.waveId, resultState: record.runtime?.resultState ?? null }
        )
      ],
      evidence: { waveRuntime: record.runtime, reason: record.reason }
    });
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
    throw new CliError('ATM_TEAM_WAVE_TASKS_REQUIRED', `team wave ${action} requires a task CSV.`, {
      exitCode: 2
    });
  }

  if (action === 'dispatch') {
    const actorFlagIndex = argv.indexOf('--actor');
    const coordinator =
      actorFlagIndex >= 0
        ? String(argv[actorFlagIndex + 1] ?? '')
        : String(process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? 'wave-coordinator');
    const record = buildWaveRuntimeRecord(cwd, taskIds, coordinator);
    const ok = record.missing.length === 0 && record.admission.ok;
    if (ok && record.envelope) {
      const dir = path.join(cwd, WAVE_RUNTIME_DIR);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, `${record.envelope.waveId}.json`),
        `${JSON.stringify(record.envelope, null, 2)}\n`,
        'utf8'
      );
    }
    return makeResult({
      ok,
      command: 'team',
      cwd,
      messages: [
        message(
          ok ? 'info' : 'error',
          ok ? 'ATM_TEAM_WAVE_DISPATCHED' : 'ATM_TEAM_WAVE_DISPATCH_BLOCKED',
          ok
            ? `Dispatched wave with ${record.admission.admitted.length} admitted member(s).`
            : `Wave dispatch blocked: ${record.missing.length} missing, ${record.admission.rejected.length} rejected.`,
          {
            admitted: record.admission.admitted,
            rejected: record.admission.rejected.map((r) => r.taskId),
            waveId: record.envelope?.waveId ?? null
          }
        )
      ],
      evidence: {
        wavePlan: record.plan,
        admission: record.admission,
        waveEnvelope: record.envelope,
        missing: record.missing
      }
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
