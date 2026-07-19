import { createHash } from 'node:crypto';
import type { WaveBrokerBatchDecision, WaveBrokerSchedulerDocument, WaveBrokerTicket } from './wave-broker-scheduler.ts';
import type { SharedWriteReceipt } from './shared-delivery-commit.ts';

export type WaveGeneratedSurfaceKind = 'build' | 'projection';

export interface WaveGeneratedWriteInput {
  readonly decision: WaveBrokerBatchDecision;
  readonly scheduler: WaveBrokerSchedulerDocument;
  readonly actorId: string;
  readonly surfaceKind: WaveGeneratedSurfaceKind;
  readonly surfaceFamily: string;
  readonly manifestDigest: string;
  readonly sealedSourceSha: string;
  readonly sourceDigest: string;
  readonly outputDigest: string;
  readonly command?: string | null;
  readonly commandExitCode?: number | null;
  readonly commandDurationMs?: number | null;
  readonly phaseTimingsMs?: Readonly<Record<string, number>> | null;
  readonly observedOutputFiles?: readonly string[];
  readonly treatmentTelemetry?: WaveGeneratedWriteTreatmentTelemetry | null;
  readonly expectedTaskIds?: readonly string[];
  readonly contentAddressedSkip?: boolean;
  readonly now?: string;
}

export interface WaveGeneratedWriteReceipt {
  readonly schemaId: 'atm.waveGeneratedWriteReceipt.v1';
  readonly specVersion: '0.1.0';
  readonly waveId: string;
  readonly surfaceKind: WaveGeneratedSurfaceKind;
  readonly surfaceFamily: string;
  readonly taskIds: readonly string[];
  readonly ticketIds: readonly string[];
  readonly manifestDigest: string;
  readonly sealedSourceSha: string;
  readonly sourceDigest: string;
  readonly outputDigest: string;
  readonly contentAddressedSkip: boolean;
  readonly command: string | null;
  readonly commandExitCode: number | null;
  readonly commandDurationMs: number | null;
  readonly phaseTimingsMs: Readonly<Record<string, number>>;
  readonly observedOutputFiles: readonly string[];
  readonly telemetry: WaveGeneratedWriteTreatmentTelemetry;
  readonly executorActor: string;
  readonly payloadDigest: string;
  readonly createdAt: string;
}

export interface WaveGeneratedWriteTreatmentTelemetry {
  readonly schemaId: 'atm.generatedWriteTreatmentTelemetry.v1';
  readonly specVersion: '0.1.0';
  readonly surfaceKind: WaveGeneratedSurfaceKind;
  readonly executionMode: 'receipt-only' | 'command-executed' | 'content-addressed-skip';
  readonly sideEffectAllowed: boolean;
  readonly commandExecuted: boolean;
  readonly outputObserved: boolean;
  readonly receiptValidity: 'valid' | 'invalid' | 'pending';
  readonly exactlyOnce: 'not-applicable' | 'observed';
  readonly skipReason: string | null;
  readonly durationMs: number | null;
  readonly phaseTimingsMs: Readonly<Record<string, number>>;
  readonly outputFileCount: number;
}

export interface WaveGeneratedWritePlan {
  readonly schemaId: 'atm.waveGeneratedWritePlan.v1';
  readonly ok: boolean;
  readonly verdict: 'receipt-ready' | 'serial-fallback' | 'blocked';
  readonly reason: string;
  readonly blockers: readonly string[];
  readonly receipt: WaveGeneratedWriteReceipt | null;
}

export interface AtomicWaveCheckpointInput {
  readonly waveId: string;
  readonly taskIds: readonly string[];
  readonly manifestDigest: string;
  readonly deliveryReceipts: readonly SharedWriteReceipt[];
  readonly buildReceipts: readonly WaveGeneratedWriteReceipt[];
  readonly projectionReceipts: readonly WaveGeneratedWriteReceipt[];
  readonly planningClosebackOk?: boolean;
  readonly now?: string;
}

export interface AtomicWaveCheckpointReadiness {
  readonly schemaId: 'atm.atomicWaveCheckpointReadiness.v1';
  readonly specVersion: '0.1.0';
  readonly waveId: string;
  readonly taskIds: readonly string[];
  readonly manifestDigest: string;
  readonly ready: boolean;
  readonly missingByTask: Readonly<Record<string, readonly string[]>>;
  readonly planningCloseback: 'ready' | 'reconcile-required';
  readonly payloadDigest: string;
  readonly createdAt: string;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function selectedTickets(document: WaveBrokerSchedulerDocument, decision: WaveBrokerBatchDecision): readonly WaveBrokerTicket[] {
  const ids = new Set(decision.ticketIds);
  return document.tickets.filter((ticket) => ids.has(ticket.ticketId));
}

function receiptCoversTask(receipts: readonly { readonly taskIds: readonly string[]; readonly waveId: string; readonly manifestDigest: string }[], waveId: string, manifestDigest: string, taskId: string): boolean {
  return receipts.some((receipt) => receipt.waveId === waveId && receipt.manifestDigest === manifestDigest && receipt.taskIds.includes(taskId));
}

export function planWaveGeneratedWrite(input: WaveGeneratedWriteInput): WaveGeneratedWritePlan {
  const blockers: string[] = [];
  const { decision } = input;
  if (decision.surfaceKind !== input.surfaceKind) blockers.push(`decision surface is not ${input.surfaceKind}`);
  if (!decision.waveId) blockers.push('decision is missing wave id');
  if (!decision.surfaceFamily) blockers.push('decision is missing surface family');
  if (decision.surfaceFamily && decision.surfaceFamily !== input.surfaceFamily) blockers.push('decision surface family does not match executor input');
  if (decision.verdict === 'waiting' || decision.verdict === 'empty') blockers.push(`scheduler decision is ${decision.verdict}`);
  if (decision.verdict === 'serial-fallback') blockers.push(`scheduler requested serial fallback: ${decision.reason}`);
  if (!input.manifestDigest.trim()) blockers.push('manifest digest is required');
  if (!input.sealedSourceSha.trim()) blockers.push('sealed source sha is required');
  if (!input.sourceDigest.trim()) blockers.push('source digest is required');
  if (!input.outputDigest.trim()) blockers.push('output digest is required');
  if (input.commandExitCode !== null && input.commandExitCode !== undefined && input.commandExitCode !== 0) blockers.push(`generated write command failed with exit code ${input.commandExitCode}`);

  const tickets = selectedTickets(input.scheduler, decision);
  const taskIds = uniqueSorted(tickets.map((ticket) => ticket.taskId));
  if (taskIds.length === 0) blockers.push('no scheduler tickets selected');
  for (const ticket of tickets) {
    if (ticket.waveId !== decision.waveId) blockers.push('selected tickets include another wave');
    if (ticket.surfaceKind !== input.surfaceKind) blockers.push('selected tickets include another surface kind');
    if (ticket.surfaceFamily !== input.surfaceFamily) blockers.push('selected tickets include another surface family');
  }
  const expected = uniqueSorted(input.expectedTaskIds ?? taskIds);
  const missingExpected = expected.filter((taskId) => !taskIds.includes(taskId));
  if (missingExpected.length > 0) blockers.push(`missing expected task receipts: ${missingExpected.join(', ')}`);

  if (blockers.length > 0) {
    return {
      schemaId: 'atm.waveGeneratedWritePlan.v1',
      ok: false,
      verdict: decision.verdict === 'serial-fallback' ? 'serial-fallback' : 'blocked',
      reason: blockers[0],
      blockers,
      receipt: null
    };
  }

  const withoutPayload = {
    schemaId: 'atm.waveGeneratedWriteReceipt.v1' as const,
    specVersion: '0.1.0' as const,
    waveId: decision.waveId!,
    surfaceKind: input.surfaceKind,
    surfaceFamily: input.surfaceFamily,
    taskIds,
    ticketIds: decision.ticketIds,
    manifestDigest: input.manifestDigest,
    sealedSourceSha: input.sealedSourceSha,
    sourceDigest: input.sourceDigest,
    outputDigest: input.outputDigest,
    contentAddressedSkip: input.contentAddressedSkip === true,
    command: input.command?.trim() || null,
    commandExitCode: input.commandExitCode ?? null,
    commandDurationMs: input.commandDurationMs ?? null,
    phaseTimingsMs: input.phaseTimingsMs ?? (input.commandDurationMs !== null && input.commandDurationMs !== undefined ? { totalElapsed: input.commandDurationMs } : {}),
    observedOutputFiles: uniqueSorted(input.observedOutputFiles ?? []),
    telemetry: input.treatmentTelemetry ?? {
      schemaId: 'atm.generatedWriteTreatmentTelemetry.v1' as const,
      specVersion: '0.1.0' as const,
      surfaceKind: input.surfaceKind,
      executionMode: input.contentAddressedSkip === true ? 'content-addressed-skip' as const : input.command ? 'command-executed' as const : 'receipt-only' as const,
      sideEffectAllowed: Boolean(input.command && input.commandExitCode === 0),
      commandExecuted: Boolean(input.command),
      outputObserved: (input.observedOutputFiles ?? []).length > 0,
      receiptValidity: 'valid' as const,
      exactlyOnce: input.command ? 'observed' as const : 'not-applicable' as const,
      skipReason: input.contentAddressedSkip === true ? 'content-addressed input/output digest match' : null,
      durationMs: input.commandDurationMs ?? null,
      phaseTimingsMs: input.phaseTimingsMs ?? (input.commandDurationMs !== null && input.commandDurationMs !== undefined ? { totalElapsed: input.commandDurationMs } : {}),
      outputFileCount: uniqueSorted(input.observedOutputFiles ?? []).length
    },
    executorActor: input.actorId,
    createdAt: input.now ?? new Date().toISOString()
  };
  const receipt: WaveGeneratedWriteReceipt = { ...withoutPayload, payloadDigest: digestJson(withoutPayload) };
  return {
    schemaId: 'atm.waveGeneratedWritePlan.v1',
    ok: true,
    verdict: 'receipt-ready',
    reason: `same-wave compatible ${input.surfaceKind} receipt ready`,
    blockers: [],
    receipt
  };
}

export function fanOutWaveGeneratedReceipt(receipt: WaveGeneratedWriteReceipt) {
  return receipt.taskIds.map((taskId) => ({
    schemaId: 'atm.waveGeneratedTaskReceiptRef.v1' as const,
    taskId,
    waveId: receipt.waveId,
    surfaceKind: receipt.surfaceKind,
    surfaceFamily: receipt.surfaceFamily,
    manifestDigest: receipt.manifestDigest,
    payloadDigest: receipt.payloadDigest
  }));
}

export function evaluateAtomicWaveCheckpoint(input: AtomicWaveCheckpointInput): AtomicWaveCheckpointReadiness {
  const taskIds = uniqueSorted(input.taskIds);
  const missingByTask: Record<string, string[]> = {};
  for (const taskId of taskIds) {
    const missing: string[] = [];
    if (!receiptCoversTask(input.deliveryReceipts, input.waveId, input.manifestDigest, taskId)) missing.push('commit');
    if (!receiptCoversTask(input.buildReceipts, input.waveId, input.manifestDigest, taskId)) missing.push('build');
    if (!receiptCoversTask(input.projectionReceipts, input.waveId, input.manifestDigest, taskId)) missing.push('projection');
    if (missing.length > 0) missingByTask[taskId] = missing;
  }
  const withoutPayload = {
    schemaId: 'atm.atomicWaveCheckpointReadiness.v1' as const,
    specVersion: '0.1.0' as const,
    waveId: input.waveId,
    taskIds,
    manifestDigest: input.manifestDigest,
    ready: Object.keys(missingByTask).length === 0 && input.planningClosebackOk !== false,
    missingByTask,
    planningCloseback: input.planningClosebackOk === false ? 'reconcile-required' as const : 'ready' as const,
    createdAt: input.now ?? new Date().toISOString()
  };
  return { ...withoutPayload, payloadDigest: digestJson(withoutPayload) };
}
