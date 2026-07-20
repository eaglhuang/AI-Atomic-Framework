import { createHash } from 'node:crypto';
import { appendPlanBatchRunEvent, readPlanBatchRun, startPlanBatchRun } from '../../../../core/dist/batch/plan-run-journal.js';
import { resolveActorId } from '../actor-registry.js';
import { CliError, makeResult, message, parseOptions } from '../shared.js';
export function runBatchExecutePlan(argv) {
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
    let batchRun = requestedBatchId ? readPlanBatchRun(options.cwd, requestedBatchId) : null;
    let startEvent = null;
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
    const event = appendPlanBatchRunEvent(options.cwd, batchRun.batchId, {
        kind: control.eventKind,
        taskId: control.currentTaskId,
        actorId: resolvedActor.actorId,
        laneSessionId,
        idempotencyKey: `${batchRun.batchId}:${control.eventKind}:${control.currentTaskId ?? 'plan'}:${control.decision}`,
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
        eventDigest: event.event.eventDigest
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
        evidence: { action: 'execute-plan', batchRun: latestRun, startEvent, event: event.event, duplicateEvent: event.duplicate, decision }
    });
}
function stripPlanExecutorArgs(argv) {
    const stripped = [];
    const customValueFlags = new Set(['--plan', '--lane', '--waited-ms', '--auto-batch']);
    const customBooleanFlags = new Set(['--pause', '--cancel']);
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (customValueFlags.has(arg)) {
            index += 1;
            continue;
        }
        if (customBooleanFlags.has(arg))
            continue;
        stripped.push(arg);
    }
    return stripped;
}
function readPlanExecutorControl(argv, batchRun) {
    const waitedMs = parseNullableNumber(readFlagValue(argv, '--waited-ms')) ?? 0;
    const circuitOpen = Boolean(process.env.ATM_AUTO_BATCH_CIRCUIT_OPEN) || readOptionValue(argv, '--auto-batch') === 'off';
    const paused = argv.includes('--pause');
    const cancelled = argv.includes('--cancel');
    const completed = batchRun.phase === 'completed' || batchRun.eventCount >= Math.max(1, batchRun.taskIds.length + 1);
    const currentIndex = Math.max(0, Math.min(batchRun.taskIds.length - 1, Math.max(0, batchRun.eventCount - 1)));
    const currentTaskId = batchRun.taskIds[currentIndex] ?? null;
    const nextTaskId = batchRun.taskIds[currentIndex + 1] ?? null;
    if (cancelled)
        return { decision: 'cancelled', eventKind: 'executor.abandoned', reason: 'operator requested cancel', currentTaskId, nextTaskId: null, nextCommand: null, recoveryCommand: `node atm.mjs batch execute-plan --actor <id> --batch ${batchRun.batchId} --json`, serialFallback: true, circuitOpen, paused: false, cancelled: true, waitedMs };
    if (paused)
        return { decision: 'paused', eventKind: 'executor.held', reason: 'operator requested pause', currentTaskId, nextTaskId: currentTaskId, nextCommand: null, recoveryCommand: `node atm.mjs batch execute-plan --actor <id> --batch ${batchRun.batchId} --json`, serialFallback: true, circuitOpen, paused: true, cancelled: false, waitedMs };
    if (circuitOpen)
        return { decision: 'circuit-open', eventKind: 'executor.held', reason: process.env.ATM_AUTO_BATCH_CIRCUIT_OPEN ? 'ATM_AUTO_BATCH_CIRCUIT_OPEN' : '--auto-batch off', currentTaskId, nextTaskId: currentTaskId, nextCommand: null, recoveryCommand: `node atm.mjs batch execute-plan --actor <id> --batch ${batchRun.batchId} --auto-batch on --json`, serialFallback: true, circuitOpen, paused: false, cancelled: false, waitedMs };
    if (completed || !currentTaskId)
        return { decision: 'completed', eventKind: 'executor.completed', reason: 'all plan tasks have executor events', currentTaskId: null, nextTaskId: null, nextCommand: null, recoveryCommand: null, serialFallback: false, circuitOpen: false, paused: false, cancelled: false, waitedMs };
    return { decision: 'next-command', eventKind: 'executor.next-selected', reason: 'queue head selected from durable plan journal', currentTaskId, nextTaskId, nextCommand: `node atm.mjs next --claim --actor ${batchRun.createdByActor} --prompt "${currentTaskId}" --auto-intent --json`, recoveryCommand: `node atm.mjs batch execute-plan --actor ${batchRun.createdByActor} --batch ${batchRun.batchId} --json`, serialFallback: batchRun.taskIds.length <= 1, circuitOpen: false, paused: false, cancelled: false, waitedMs };
}
function createPlanExecutorDecisionReceipt(input) {
    const decisionInput = {
        batchId: input.batchRun.batchId,
        planDigest: input.batchRun.planDigest,
        eventCount: input.batchRun.eventCount,
        lastEventDigest: input.batchRun.lastEventDigest,
        decision: input.decision,
        currentTaskId: input.currentTaskId,
        reason: input.reason,
        eventDigest: input.eventDigest
    };
    return {
        schemaId: 'atm.planExecutorDecisionReceipt.v1',
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
        windowDecision: {
            schemaId: 'atm.planExecutorWindowDecision.v1',
            serialFallback: input.serialFallback,
            circuitOpen: input.circuitOpen,
            paused: input.paused,
            cancelled: input.cancelled,
            waitedMs: Math.max(0, input.waitedMs),
            source: 'runtime-journal-summary'
        },
        dataPolicy: { rawRuntimeStore: '.atm/runtime/batch-runs/**', gitTrackedEvidence: 'digest-only', rawLogsCommitted: false },
        decisionDigest: digestJson(decisionInput),
        inputDigest: digestJson({ taskIds: input.batchRun.taskIds, planDigest: input.batchRun.planDigest }),
        configDigest: digestJson({ autoBatchCircuitOpen: input.circuitOpen, serialFallback: input.serialFallback })
    };
}
function collectRepeatedValues(argv, flag) {
    const values = [];
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === flag && argv[index + 1] && !String(argv[index + 1]).startsWith('--')) {
            values.push(String(argv[index + 1]));
            index += 1;
        }
    }
    return values;
}
function readFlagValue(argv, flag) {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] && !String(argv[index + 1]).startsWith('--') ? String(argv[index + 1]) : null;
}
function readOptionValue(argv, flag) {
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length ? String(argv[index + 1]) : null;
}
function parseNullableNumber(value) {
    if (typeof value !== 'string' && typeof value !== 'number')
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function digestJson(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
