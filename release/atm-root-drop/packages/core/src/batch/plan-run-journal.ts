import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const ATM_BATCH_PLAN_DIGEST_MISMATCH = 'ATM_BATCH_PLAN_DIGEST_MISMATCH';
export const ATM_BATCH_RUN_EVENT_JOURNAL_INVALID = 'ATM_BATCH_RUN_EVENT_JOURNAL_INVALID';

export type PlanBatchRunPhase = 'created' | 'active' | 'held' | 'completed' | 'abandoned';
export type PlanExecutorPhaseKind =
  | 'preflight'
  | 'select'
  | 'claim'
  | 'workers'
  | 'reconcile'
  | 'validate'
  | 'proposal-sealed'
  | 'broker-ticketed'
  | 'composing'
  | 'semantic-revalidation'
  | 'prepared'
  | 'published'
  | 'generated-writes'
  | 'commit'
  | 'checkpoint'
  | 'closeback'
  | 'analyze';

export const planExecutorPhaseChain: readonly PlanExecutorPhaseKind[] = Object.freeze([
  'preflight',
  'select',
  'claim',
  'workers',
  'reconcile',
  'validate',
  'proposal-sealed',
  'broker-ticketed',
  'composing',
  'semantic-revalidation',
  'prepared',
  'published',
  'generated-writes',
  'commit',
  'checkpoint',
  'closeback',
  'analyze'
]);

export interface PlanBatchRunJournalEvent {
  readonly schemaId: 'atm.batchRunJournalEvent.v1';
  readonly eventId: string;
  readonly batchId: string;
  readonly kind: string;
  readonly taskId: string | null;
  readonly actorId: string;
  readonly laneSessionId: string | null;
  readonly tokenUsage: {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly cacheReadTokens: number | null;
    readonly source: 'provider' | 'manual' | 'unavailable';
  };
  readonly waitedMs: number;
  readonly createdAt: string;
  readonly idempotencyKey: string;
  readonly eventDigest: string;
  readonly phase?: PlanExecutorPhaseKind;
  readonly inputDigest?: string;
  readonly outputDigest?: string;
  readonly sideEffectReceiptDigest?: string | null;
  readonly terminal?: boolean;
  readonly skipReason?: string | null;
}

export interface PlanBatchRunRecord {
  readonly schemaId: 'atm.batchRun.v1';
  readonly specVersion: '0.2';
  readonly batchId: string;
  readonly planDigest: string;
  readonly planPath: string | null;
  readonly taskIds: readonly string[];
  readonly phase: PlanBatchRunPhase;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdByActor: string;
  readonly laneSessionId: string | null;
  readonly journalPath: string;
  readonly eventCount: number;
  readonly lastEventDigest: string | null;
  readonly completedPhaseKeys?: readonly string[];
  readonly sideEffectReceiptDigests?: Readonly<Record<string, string>>;
}

export function startPlanBatchRun(input: {
  readonly cwd: string;
  readonly actorId: string;
  readonly planPath?: string | null;
  readonly taskIds: readonly string[];
  readonly laneSessionId?: string | null;
  readonly nowIso?: string;
}) {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const planDigest = computePlanDigest(input.cwd, input.planPath ?? null, input.taskIds);
  const batchId = `plan-batch-${nowIso.replace(/[:.]/g, '-')}-${planDigest.slice(7, 15)}`;
  const journalPath = planBatchJournalRelativePath(batchId);
  const record: PlanBatchRunRecord = {
    schemaId: 'atm.batchRun.v1',
    specVersion: '0.2',
    batchId,
    planDigest,
    planPath: input.planPath ?? null,
    taskIds: [...input.taskIds],
    phase: 'created',
    createdAt: nowIso,
    updatedAt: nowIso,
    createdByActor: input.actorId,
    laneSessionId: input.laneSessionId ?? null,
    journalPath,
    eventCount: 0,
    lastEventDigest: null
  };
  writePlanBatchRun(input.cwd, record);
  const append = appendPlanBatchRunEvent(input.cwd, batchId, {
    kind: 'batch.created',
    taskId: null,
    actorId: input.actorId,
    laneSessionId: input.laneSessionId ?? null,
    idempotencyKey: `${batchId}:created`,
    nowIso
  });
  return { batchRun: append.batchRun, event: append.event };
}

export function appendPlanBatchRunEvent(cwd: string, batchId: string, input: {
  readonly kind: string;
  readonly taskId?: string | null;
  readonly phase?: PlanExecutorPhaseKind | null;
  readonly actorId: string;
  readonly laneSessionId?: string | null;
  readonly idempotencyKey: string;
  readonly inputDigest?: string | null;
  readonly outputDigest?: string | null;
  readonly sideEffectReceiptDigest?: string | null;
  readonly terminal?: boolean | null;
  readonly skipReason?: string | null;
  readonly inputTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly cacheReadTokens?: number | null;
  readonly tokenSource?: 'provider' | 'manual' | 'unavailable';
  readonly waitedMs?: number | null;
  readonly nowIso?: string;
}) {
  const batchRun = readPlanBatchRun(cwd, batchId);
  if (!batchRun) {
    throw new Error(`${ATM_BATCH_RUN_EVENT_JOURNAL_INVALID}: batch ${batchId} not found`);
  }
  const existing = readJournalEvents(cwd, batchRun.journalPath);
  const duplicate = existing.find((event) => event.idempotencyKey === input.idempotencyKey);
  if (duplicate) return { batchRun, event: duplicate, duplicate: true };
  const createdAt = input.nowIso ?? new Date().toISOString();
  const eventId = `${createdAt.replace(/[:.]/g, '-')}-${hashText(input.idempotencyKey).slice(0, 12)}`;
  const eventSeed = {
    batchId,
    kind: input.kind,
    taskId: input.taskId ?? null,
    phase: input.phase ?? null,
    actorId: input.actorId,
    laneSessionId: input.laneSessionId ?? null,
    idempotencyKey: input.idempotencyKey,
    inputDigest: input.inputDigest ?? null,
    outputDigest: input.outputDigest ?? null,
    sideEffectReceiptDigest: input.sideEffectReceiptDigest ?? null,
    terminal: input.terminal ?? false,
    skipReason: input.skipReason ?? null,
    createdAt
  };
  const event: PlanBatchRunJournalEvent = {
    schemaId: 'atm.batchRunJournalEvent.v1',
    eventId,
    ...eventSeed,
    tokenUsage: {
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      cacheReadTokens: input.cacheReadTokens ?? null,
      source: input.tokenSource ?? 'unavailable'
    },
    waitedMs: Math.max(0, input.waitedMs ?? 0),
    eventDigest: `sha256:${hashJson(eventSeed)}`,
    phase: input.phase ?? undefined,
    inputDigest: input.inputDigest ?? undefined,
    outputDigest: input.outputDigest ?? undefined,
    sideEffectReceiptDigest: input.sideEffectReceiptDigest ?? null,
    terminal: input.terminal ?? false,
    skipReason: input.skipReason ?? null
  };
  appendJournalEvent(cwd, batchRun.journalPath, event);
  const updated: PlanBatchRunRecord = {
    ...batchRun,
    phase: nextPhase(batchRun.phase, input.kind),
    updatedAt: createdAt,
    eventCount: existing.length + 1,
    lastEventDigest: event.eventDigest,
    completedPhaseKeys: nextCompletedPhaseKeys(batchRun.completedPhaseKeys ?? [], event),
    sideEffectReceiptDigests: nextSideEffectReceiptDigests(batchRun.sideEffectReceiptDigests ?? {}, event)
  };
  writePlanBatchRun(cwd, updated);
  return { batchRun: updated, event, duplicate: false };
}

export function readPlanBatchRunEvents(cwd: string, batchId: string): readonly PlanBatchRunJournalEvent[] {
  const batchRun = readPlanBatchRun(cwd, batchId);
  if (!batchRun) return [];
  return readJournalEvents(cwd, batchRun.journalPath);
}

export function readPlanBatchRun(cwd: string, batchId: string): PlanBatchRunRecord | null {
  const filePath = path.join(cwd, '.atm', 'runtime', 'batch-runs', `${batchId}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8')) as PlanBatchRunRecord;
}

export function planBatchRunRelativePath(batchId: string) {
  return path.join('.atm', 'runtime', 'batch-runs', `${batchId}.json`);
}

export function planBatchJournalRelativePath(batchId: string) {
  return path.join('.atm', 'runtime', 'batch-runs', `${batchId}.journal.jsonl`);
}

function computePlanDigest(cwd: string, planPath: string | null, taskIds: readonly string[]) {
  const resolved = planPath ? path.resolve(cwd, planPath) : null;
  const planText = resolved && existsSync(resolved) ? readFileSync(resolved, 'utf8') : '';
  return `sha256:${hashJson({ planPath, planText, taskIds })}`;
}

function writePlanBatchRun(cwd: string, record: PlanBatchRunRecord) {
  const filePath = path.join(cwd, planBatchRunRelativePath(record.batchId));
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

function readJournalEvents(cwd: string, relativePath: string) {
  const filePath = path.join(cwd, relativePath);
  if (!existsSync(filePath)) return [] as PlanBatchRunJournalEvent[];
  return readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as PlanBatchRunJournalEvent);
}

function appendJournalEvent(cwd: string, relativePath: string, event: PlanBatchRunJournalEvent) {
  const filePath = path.join(cwd, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  writeFileSync(filePath, `${existing}${JSON.stringify(event)}\n`, 'utf8');
}

function nextPhase(current: PlanBatchRunPhase, kind: string): PlanBatchRunPhase {
  if (kind.endsWith('.completed')) return 'completed';
  if (kind.endsWith('.abandoned')) return 'abandoned';
  if (kind.endsWith('.held')) return 'held';
  if (current === 'created') return 'active';
  return current;
}

function nextCompletedPhaseKeys(current: readonly string[], event: PlanBatchRunJournalEvent) {
  if (!event.phase || !event.taskId || !event.terminal) return current;
  return [...new Set([...current, `${event.taskId}:${event.phase}`])].sort();
}

function nextSideEffectReceiptDigests(current: Readonly<Record<string, string>>, event: PlanBatchRunJournalEvent) {
  if (!event.taskId || !event.phase || !event.sideEffectReceiptDigest) return current;
  return { ...current, [`${event.taskId}:${event.phase}`]: event.sideEffectReceiptDigest };
}

function hashJson(value: unknown) {
  return hashText(JSON.stringify(value));
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
