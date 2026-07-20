import { createHash } from 'node:crypto';
import {
  appendPlanBatchRunEvent,
  planExecutorPhaseChain,
  readPlanBatchRunEvents,
  readPlanBatchRun,
  startPlanBatchRun,
  type PlanExecutorPhaseKind,
  type PlanBatchRunRecord
} from '../../../../core/src/batch/plan-run-journal.ts';
import { buildTelemetryObservation } from '../../../../core/src/telemetry/observation.ts';
import { resolveActorId } from '../actor-registry.ts';
import { CliError, makeResult, message, parseOptions } from '../shared.ts';

export function runBatchExecutePlan(argv: string[]) {
  const { options } = parseOptions(stripPlanExecutorArgs(argv), 'batch');
  const resolvedActor = resolveActorId(options.agent ?? undefined);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'batch execute-plan requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
  }

  const requestedBatchId = typeof options.batch === 'string' ? options.batch.trim() : '';
  const requestedTaskIds = collectRepeatedValues(argv, '--task');
  const planPath = readFlagValue(argv, '--plan');
  const laneSessionId = readFlagValue(argv, '--lane') ?? process.env.ATM_LANE_SESSION_ID ?? null;
  const nowIso = new Date().toISOString();
  let batchRun: PlanBatchRunRecord | null = requestedBatchId ? readPlanBatchRun(options.cwd, requestedBatchId) : null;
  let startEvent: unknown = null;

  if (!batchRun) {
    if (requestedBatchId) {
      throw new CliError('ATM_BATCH_STATE_REPAIR_REQUIRED', `Plan batch run ${requestedBatchId} was not found.`, {
        exitCode: 1,
        details: { batchId: requestedBatchId, recoveryCommand: 'node atm.mjs batch execute-plan --actor <id> --task <id> --json' }
      });
    }
    if (requestedTaskIds.length === 0) {
      throw new CliError('ATM_CLI_USAGE', 'batch execute-plan requires --batch <id> or at least one --task <id> to start a durable plan run.', { exitCode: 2 });
    }
    const started = startPlanBatchRun({ cwd: options.cwd, actorId: resolvedActor.actorId, planPath, taskIds: requestedTaskIds, laneSessionId, nowIso });
    batchRun = started.batchRun;
    startEvent = started.event;
  }

  const control = readPlanExecutorControl(argv, batchRun);
  const loopReceipt = control.decision === 'next-command' && argv.includes('--run-loop')
    ? runPlanExecutorLoop({
        cwd: options.cwd,
        batchRun,
        actorId: resolvedActor.actorId,
        laneSessionId,
        currentTaskId: control.currentTaskId,
        crashAfter: readFlagValue(argv, '--crash-after') as PlanExecutorPhaseKind | null,
        ticketMode: readFlagValue(argv, '--ticket') ?? 'execute',
        nowIso,
        waitedMs: control.waitedMs
      })
    : null;
  const eventKind = loopReceipt?.terminal ? 'executor.completed' : control.eventKind;
  const event = appendPlanBatchRunEvent(options.cwd, batchRun.batchId, {
    kind: eventKind,
    taskId: control.currentTaskId,
    actorId: resolvedActor.actorId,
    laneSessionId,
    idempotencyKey: `${batchRun.batchId}:${eventKind}:${control.currentTaskId ?? 'plan'}:${control.decision}:${loopReceipt?.digest ?? 'advisory'}`,
    waitedMs: control.waitedMs,
    nowIso
  });
  const latestRun = event.batchRun;
  const decision = createPlanExecutorDecisionReceipt({
    batchRun: latestRun,
    actorId: resolvedActor.actorId,
    laneSessionId,
    decision: control.decision,
    reason: control.reason,
    currentTaskId: control.currentTaskId,
    nextTaskId: control.nextTaskId,
    nextCommand: control.nextCommand,
    recoveryCommand: control.recoveryCommand,
    serialFallback: control.serialFallback,
    circuitOpen: control.circuitOpen,
    paused: control.paused,
    cancelled: control.cancelled,
    waitedMs: control.waitedMs,
    eventDigest: event.event.eventDigest,
    loopReceipt
  });
  const level = decision.decision === 'cancelled' || decision.decision === 'circuit-open' ? 'warning' : 'info';
  const code = decision.decision === 'completed'
    ? 'ATM_BATCH_EXECUTE_PLAN_COMPLETED'
    : decision.decision === 'paused'
      ? 'ATM_BATCH_EXECUTE_PLAN_PAUSED'
      : decision.decision === 'cancelled'
        ? 'ATM_BATCH_EXECUTE_PLAN_CANCELLED'
        : decision.decision === 'circuit-open'
          ? 'ATM_BATCH_EXECUTE_PLAN_CIRCUIT_OPEN'
          : 'ATM_BATCH_EXECUTE_PLAN_NEXT';

  return makeResult({
    ok: decision.decision !== 'cancelled' && decision.decision !== 'circuit-open',
    command: 'batch',
    cwd: options.cwd,
    messages: [message(level, code, 'Plan-level executor selected the next recovery command.', {
      batchId: latestRun.batchId,
      decision: decision.decision,
      nextCommand: decision.nextCommand,
      recoveryCommand: decision.recoveryCommand,
      serialFallback: decision.windowDecision.serialFallback,
      decisionDigest: decision.decisionDigest
    })],
    evidence: { action: 'execute-plan', batchRun: latestRun, startEvent, event: event.event, duplicateEvent: event.duplicate, loopReceipt, decision }
  });
}

function stripPlanExecutorArgs(argv: readonly string[]) {
  const stripped: string[] = [];
  const customValueFlags = new Set(['--plan', '--lane', '--waited-ms', '--auto-batch', '--crash-after', '--ticket']);
  const customBooleanFlags = new Set(['--pause', '--cancel', '--run-loop']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (customValueFlags.has(arg)) {
      index += 1;
      continue;
    }
    if (customBooleanFlags.has(arg)) continue;
    stripped.push(arg);
  }
  return stripped;
}

function readPlanExecutorControl(argv: readonly string[], batchRun: PlanBatchRunRecord) {
  const waitedMs = parseNullableNumber(readFlagValue(argv, '--waited-ms')) ?? 0;
  const circuitOpen = Boolean(process.env.ATM_AUTO_BATCH_CIRCUIT_OPEN) || readOptionValue(argv, '--auto-batch') === 'off';
  const paused = argv.includes('--pause');
  const cancelled = argv.includes('--cancel');
  const runLoop = argv.includes('--run-loop');
  const completedPhaseKeys = new Set(batchRun.completedPhaseKeys ?? []);
  const currentIndex = runLoop
    ? Math.max(0, batchRun.taskIds.findIndex((taskId) => !isTaskPhaseComplete(taskId, completedPhaseKeys)))
    : Math.max(0, Math.min(batchRun.taskIds.length - 1, Math.max(0, batchRun.eventCount - 1)));
  const completed = runLoop
    ? batchRun.taskIds.length > 0 && batchRun.taskIds.every((taskId) => isTaskPhaseComplete(taskId, completedPhaseKeys))
    : batchRun.phase === 'completed' || batchRun.eventCount >= Math.max(1, batchRun.taskIds.length + 1);
  const currentTaskId = batchRun.taskIds[currentIndex] ?? null;
  const nextTaskId = batchRun.taskIds[currentIndex + 1] ?? null;
  if (cancelled) return { decision: 'cancelled' as const, eventKind: 'executor.abandoned', reason: 'operator requested cancel', currentTaskId, nextTaskId: null, nextCommand: null, recoveryCommand: `node atm.mjs batch execute-plan --actor <id> --batch ${batchRun.batchId} --json`, serialFallback: true, circuitOpen, paused: false, cancelled: true, waitedMs };
  if (paused) return { decision: 'paused' as const, eventKind: 'executor.held', reason: 'operator requested pause', currentTaskId, nextTaskId: currentTaskId, nextCommand: null, recoveryCommand: `node atm.mjs batch execute-plan --actor <id> --batch ${batchRun.batchId} --json`, serialFallback: true, circuitOpen, paused: true, cancelled: false, waitedMs };
  if (circuitOpen) return { decision: 'circuit-open' as const, eventKind: 'executor.held', reason: process.env.ATM_AUTO_BATCH_CIRCUIT_OPEN ? 'ATM_AUTO_BATCH_CIRCUIT_OPEN' : '--auto-batch off', currentTaskId, nextTaskId: currentTaskId, nextCommand: null, recoveryCommand: `node atm.mjs batch execute-plan --actor <id> --batch ${batchRun.batchId} --auto-batch on --json`, serialFallback: true, circuitOpen, paused: false, cancelled: false, waitedMs };
  if (completed || !currentTaskId) return { decision: 'completed' as const, eventKind: 'executor.completed', reason: 'all plan tasks have executor events', currentTaskId: null, nextTaskId: null, nextCommand: null, recoveryCommand: null, serialFallback: false, circuitOpen: false, paused: false, cancelled: false, waitedMs };
  return { decision: 'next-command' as const, eventKind: 'executor.next-selected', reason: 'queue head selected from durable plan journal', currentTaskId, nextTaskId, nextCommand: `node atm.mjs next --claim --actor ${batchRun.createdByActor} --prompt "${currentTaskId}" --auto-intent --json`, recoveryCommand: `node atm.mjs batch execute-plan --actor ${batchRun.createdByActor} --batch ${batchRun.batchId} --json`, serialFallback: batchRun.taskIds.length <= 1, circuitOpen: false, paused: false, cancelled: false, waitedMs };
}

function isTaskPhaseComplete(taskId: string, completedPhaseKeys: ReadonlySet<string>) {
  return planExecutorPhaseChain.every((phase) => completedPhaseKeys.has(`${taskId}:${phase}`));
}

function createPlanExecutorDecisionReceipt(input: {
  readonly batchRun: PlanBatchRunRecord;
  readonly actorId: string;
  readonly laneSessionId: string | null;
  readonly decision: 'next-command' | 'paused' | 'cancelled' | 'circuit-open' | 'completed';
  readonly reason: string;
  readonly currentTaskId: string | null;
  readonly nextTaskId: string | null;
  readonly nextCommand: string | null;
  readonly recoveryCommand: string | null;
  readonly serialFallback: boolean;
  readonly circuitOpen: boolean;
  readonly paused: boolean;
  readonly cancelled: boolean;
  readonly waitedMs: number;
  readonly eventDigest: string;
  readonly loopReceipt: PlanExecutorLoopReceipt | null;
}) {
  const decisionInput = {
    batchId: input.batchRun.batchId,
    planDigest: input.batchRun.planDigest,
    eventCount: input.batchRun.eventCount,
    lastEventDigest: input.batchRun.lastEventDigest,
    decision: input.decision,
    currentTaskId: input.currentTaskId,
    reason: input.reason,
    eventDigest: input.eventDigest,
    loopDigest: input.loopReceipt?.digest ?? null
  };
  return {
    schemaId: 'atm.planExecutorDecisionReceipt.v1' as const,
    batchId: input.batchRun.batchId,
    actorId: input.actorId,
    laneSessionId: input.laneSessionId,
    phase: input.batchRun.phase,
    decision: input.decision,
    reason: input.reason,
    currentTaskId: input.currentTaskId,
    nextTaskId: input.nextTaskId,
    nextCommand: input.nextCommand,
    recoveryCommand: input.recoveryCommand,
    loopReceipt: input.loopReceipt,
    windowDecision: {
      schemaId: 'atm.planExecutorWindowDecision.v1' as const,
      serialFallback: input.serialFallback,
      circuitOpen: input.circuitOpen,
      paused: input.paused,
      cancelled: input.cancelled,
      waitedMs: Math.max(0, input.waitedMs),
      source: 'runtime-journal-summary' as const
    },
    dataPolicy: { rawRuntimeStore: '.atm/runtime/batch-runs/**', gitTrackedEvidence: 'digest-only', rawLogsCommitted: false },
    decisionDigest: digestJson(decisionInput),
    inputDigest: digestJson({ taskIds: input.batchRun.taskIds, planDigest: input.batchRun.planDigest }),
    configDigest: digestJson({ autoBatchCircuitOpen: input.circuitOpen, serialFallback: input.serialFallback })
  };
}

interface PlanExecutorLoopReceipt {
  readonly schemaId: 'atm.planExecutorLoopReceipt.v1';
  readonly batchId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly laneSessionId: string | null;
  readonly phaseCount: number;
  readonly completedPhases: readonly PlanExecutorPhaseKind[];
  readonly nextPhase: PlanExecutorPhaseKind | null;
  readonly terminal: boolean;
  readonly ticketMode: string;
  readonly crashAfter: PlanExecutorPhaseKind | null;
  readonly recoveryCommand: string | null;
  readonly sideEffectReceiptDigests: Readonly<Record<string, string>>;
  readonly observations: readonly unknown[];
  readonly digest: string;
}

function runPlanExecutorLoop(input: {
  readonly cwd: string;
  readonly batchRun: PlanBatchRunRecord;
  readonly actorId: string;
  readonly laneSessionId: string | null;
  readonly currentTaskId: string | null;
  readonly crashAfter: PlanExecutorPhaseKind | null;
  readonly ticketMode: string;
  readonly nowIso: string;
  readonly waitedMs: number;
}): PlanExecutorLoopReceipt | null {
  if (!input.currentTaskId) return null;
  const taskId = input.currentTaskId;
  const existingEvents = readPlanBatchRunEvents(input.cwd, input.batchRun.batchId);
  const completed = new Set(existingEvents.filter((event) => event.taskId === taskId && event.phase && event.terminal).map((event) => event.phase as PlanExecutorPhaseKind));
  const sideEffectReceiptDigests: Record<string, string> = {};
  const observations: unknown[] = [];
  let stoppedAtCrash = false;
  for (const phase of planExecutorPhaseChain) {
    if (completed.has(phase)) {
      const digest = input.batchRun.sideEffectReceiptDigests?.[`${taskId}:${phase}`];
      if (digest) sideEffectReceiptDigests[phase] = digest;
      continue;
    }
    const inputDigest = digestJson({ taskId, phase, planDigest: input.batchRun.planDigest, ticketMode: input.ticketMode });
    const receiptDigest = isSideEffectPhase(phase) ? digestJson({ taskId, phase, batchId: input.batchRun.batchId, exactlyOnce: true }) : null;
    const outputDigest = digestJson({ inputDigest, receiptDigest, terminal: true });
    const event = appendPlanBatchRunEvent(input.cwd, input.batchRun.batchId, {
      kind: `phase.${phase}.completed`,
      taskId,
      phase,
      actorId: input.actorId,
      laneSessionId: input.laneSessionId,
      idempotencyKey: `${input.batchRun.batchId}:${taskId}:${phase}:terminal`,
      inputDigest,
      outputDigest,
      sideEffectReceiptDigest: receiptDigest,
      terminal: true,
      waitedMs: input.waitedMs,
      nowIso: input.nowIso
    });
    completed.add(phase);
    if (receiptDigest) sideEffectReceiptDigests[phase] = receiptDigest;
    observations.push(buildTelemetryObservation({
      observationId: event.event.eventId,
      producerId: 'plan-executor.phase',
      observationKind: `phase.${phase}`,
      status: 'canonical',
      source: 'packages/cli/src/commands/batch/plan-executor.ts',
      sourceAvailability: 'available',
      storagePolicy: 'runtime-raw-tracked-digest',
      timing: { observedAt: input.nowIso, durationMs: input.waitedMs },
      correlation: { actorId: input.actorId, laneSessionId: input.laneSessionId, taskId, batchId: input.batchRun.batchId },
      inputDigest,
      outputDigest,
      configDigest: digestJson({ ticketMode: input.ticketMode }),
      extensions: {
        phase,
        sideEffectReceiptDigest: receiptDigest,
        composeFirstState: composeFirstStateForPhase(phase, input.ticketMode)
      }
    }));
    if (input.crashAfter === phase) {
      stoppedAtCrash = true;
      break;
    }
  }
  const completedPhases = planExecutorPhaseChain.filter((phase) => completed.has(phase));
  const nextPhase = planExecutorPhaseChain.find((phase) => !completed.has(phase)) ?? null;
  const terminal = !nextPhase && !stoppedAtCrash;
  const receiptSeed = { batchId: input.batchRun.batchId, taskId, completedPhases, nextPhase, terminal, ticketMode: input.ticketMode, sideEffectReceiptDigests };
  return {
    schemaId: 'atm.planExecutorLoopReceipt.v1',
    batchId: input.batchRun.batchId,
    taskId,
    actorId: input.actorId,
    laneSessionId: input.laneSessionId,
    phaseCount: planExecutorPhaseChain.length,
    completedPhases,
    nextPhase,
    terminal,
    ticketMode: input.ticketMode,
    crashAfter: input.crashAfter,
    recoveryCommand: terminal ? null : `node atm.mjs batch execute-plan --actor ${input.actorId} --batch ${input.batchRun.batchId} --run-loop --json`,
    sideEffectReceiptDigests,
    observations,
    digest: digestJson(receiptSeed)
  };
}

function isSideEffectPhase(phase: PlanExecutorPhaseKind) {
  return phase === 'published' || phase === 'generated-writes' || phase === 'commit' || phase === 'checkpoint' || phase === 'closeback';
}

function composeFirstStateForPhase(phase: PlanExecutorPhaseKind, ticketMode: string) {
  if (phase === 'broker-ticketed') return ticketMode === 'queued' ? 'queued-ticket' : 'execute-ticket';
  if (phase === 'composing') return ticketMode === 'queued' ? 'wakeup-compose' : 'compose-parallel';
  if (phase === 'semantic-revalidation') return ticketMode === 'stale-read-set' ? 'revalidated-after-stale-read-set' : 'validated';
  return 'not-shared-write';
}

function collectRepeatedValues(argv: readonly string[], flag: string) {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1] && !String(argv[index + 1]).startsWith('--')) {
      values.push(String(argv[index + 1]));
      index += 1;
    }
  }
  return values;
}

function readFlagValue(argv: readonly string[], flag: string) {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] && !String(argv[index + 1]).startsWith('--') ? String(argv[index + 1]) : null;
}

function readOptionValue(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? String(argv[index + 1]) : null;
}

function parseNullableNumber(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function digestJson(value: unknown) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
