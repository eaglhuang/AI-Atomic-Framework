import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const gateTelemetrySpecVersion = 'atm.gateTelemetry.v1';
export const gateTelemetryRuntimeRelativePath = path.join('.atm', 'runtime', 'telemetry');
export const gateTelemetryHistoryRelativePath = path.join('.atm', 'history', 'telemetry');
export const gateTelemetryEvidenceRelativePath = path.join('.atm', 'history', 'evidence', 'governance-telemetry');

export type GateTelemetryResult = 'pass' | 'block' | 'warn' | 'skip' | 'error';

export interface GateCheckRegistryEntry {
  readonly checkId: string;
  readonly checkVersion: string;
  readonly gate: string;
  readonly owner: string;
  readonly summary: string;
}

export type GateTelemetryCoverageStatus = 'instrumented' | 'read-only-summary' | 'out-of-scope' | 'not-yet-covered';
export type GateTelemetrySourceAvailability = 'available' | 'unavailable' | 'partial';
export type GateTelemetryM2PreflightVerdict = 'ready' | 'inconclusive' | 'blocked';

export interface GateTelemetryRequiredNodeCoverage {
  readonly nodeId: string;
  readonly nodeFamily: string;
  readonly coverageStatus: GateTelemetryCoverageStatus;
  readonly producerCheckIds: readonly string[];
  readonly consumerIds: readonly string[];
  readonly requiredCorrelationKeys: readonly string[];
  readonly missingCorrelationKeys: readonly string[];
  readonly sourceAvailability: GateTelemetrySourceAvailability;
  readonly missingTelemetry: readonly string[];
  readonly m2Comparable: boolean;
}

export interface GateTelemetryRegistryCoverageReport {
  readonly schemaId: 'atm.gateTelemetryRegistryCoverageReport.v1';
  readonly generatedAt: string;
  readonly configDigest: string;
  readonly historyDigest: string;
  readonly requiredNodes: readonly GateTelemetryRequiredNodeCoverage[];
  readonly droppedEvents: number;
  readonly malformedEvents: number;
  readonly m2Comparable: boolean;
  readonly m2PreflightVerdict: GateTelemetryM2PreflightVerdict;
  readonly rawDataPolicy: {
    readonly runtimeStorage: '.atm/runtime/telemetry/**';
    readonly trackedEvidence: 'compact-digest-only';
    readonly rawTelemetryCommitted: false;
  };
}

export interface GateTelemetryTaskSummary {
  readonly schemaId: 'atm.gateTelemetryTaskSummary.v1';
  readonly taskId: string;
  readonly generatedAt: string;
  readonly window: {
    readonly start: string | null;
    readonly end: string | null;
    readonly watermark: string | null;
  };
  readonly correlation: {
    readonly runIds: readonly string[];
    readonly laneSessionIds: readonly string[];
    readonly batchIds: readonly string[];
    readonly waveIds: readonly string[];
  };
  readonly gateEvents: GateTelemetryReport['byCheckId'];
  readonly uniqueBlocks: readonly string[];
  readonly truePositiveStatus: 'unclassified' | 'classified';
  readonly evidenceReadbacks: number;
  readonly warnings: readonly string[];
  readonly droppedEvents: number;
  readonly missingTelemetry: readonly string[];
  readonly baselineOrTreatmentRole: 'baseline' | 'treatment' | 'm2-preflight' | 'unknown';
  readonly sourceAvailability: GateTelemetrySourceAvailability;
  readonly historyDigest: string;
  readonly configDigest: string;
}

export interface GateTelemetryEvent {
  readonly specVersion: typeof gateTelemetrySpecVersion;
  readonly eventId: string;
  readonly sequence: number;
  readonly observedAt: string;
  readonly gate: string;
  readonly checkId: string;
  readonly checkVersion: string;
  readonly policyVersion: string;
  readonly eligible: boolean;
  readonly result: GateTelemetryResult;
  readonly reasonClass: string;
  readonly durationMs: number;
  readonly actorId: string;
  readonly runId: string;
  readonly correlationId: string;
  readonly laneSessionId?: string | null;
  readonly taskId?: string | null;
  readonly batchId?: string | null;
  readonly waveId?: string | null;
  readonly command: string;
  readonly inputDigest: string;
  readonly configDigest: string;
  readonly source: 'runtime' | 'fixture' | 'classification';
  readonly redactionClass: 'none' | 'path-redacted' | 'secret-redacted';
  readonly failureEnvelopeRef?: string | null;
  readonly evidenceReadRef?: string | null;
}

export interface GateTelemetryMetaHealth {
  readonly droppedEvents: number;
  readonly malformedEvents: number;
  readonly warnings: readonly string[];
}

export interface GateTelemetrySealDigest {
  readonly schemaId: 'atm.gateTelemetrySealDigest.v1';
  readonly taskId: string;
  readonly windowId: string;
  readonly sealedAt: string;
  readonly watermark: string;
  readonly eventCount: number;
  readonly historyPath: string;
  readonly historyDigest: string;
  readonly metaHealth: GateTelemetryMetaHealth;
}

export interface GateTelemetryReport {
  readonly schemaId: 'atm.gateTelemetryReport.v1';
  readonly generatedAt: string;
  readonly source: 'sealed-history' | 'sealed-history+runtime';
  readonly eventCount: number;
  readonly byCheckId: Record<string, {
    readonly eligible: number;
    readonly resultCounts: Record<string, number>;
    readonly durationP50: number | null;
    readonly durationP95: number | null;
    readonly evidenceReadbacks: number;
  }>;
  readonly uniqueBlocks: readonly string[];
  readonly truePositiveStatus: 'unclassified' | 'classified';
  readonly metaHealth: GateTelemetryMetaHealth;
}

export const canonicalGateCheckRegistry: readonly GateCheckRegistryEntry[] = Object.freeze([
  { checkId: 'next.route-resolution', checkVersion: '1.0.0', gate: 'next', owner: 'atm-core', summary: 'Prompt and task scope route resolution.' },
  { checkId: 'doctor.readiness', checkVersion: '1.0.0', gate: 'doctor', owner: 'atm-core', summary: 'Repository readiness doctor check.' },
  { checkId: 'guard.framework-mode', checkVersion: '1.0.0', gate: 'guard', owner: 'atm-core', summary: 'Framework development guard decision.' },
  { checkId: 'tasks.claim-admission', checkVersion: '1.0.0', gate: 'tasks', owner: 'atm-core', summary: 'Task claim admission and ownership check.' },
  { checkId: 'taskflow.close-readiness', checkVersion: '1.0.0', gate: 'taskflow', owner: 'atm-core', summary: 'Task close readiness check.' },
  { checkId: 'batch.checkpoint-readiness', checkVersion: '1.0.0', gate: 'batch', owner: 'atm-core', summary: 'Batch checkpoint readiness check.' },
  { checkId: 'broker.shared-surface-admission', checkVersion: '1.0.0', gate: 'broker', owner: 'atm-core', summary: 'Shared surface broker admission check.' },
  { checkId: 'telemetry.registry-coverage', checkVersion: '1.0.0', gate: 'telemetry', owner: 'atm-core', summary: 'Gate telemetry registry coverage and M2 preflight report.' }
]);

export const canonicalGateTelemetryRequiredNodes: readonly GateTelemetryRequiredNodeCoverage[] = Object.freeze([
  coverageNode('claim-reservation-lane-presence', 'claim/reservation/lane presence', 'instrumented', ['tasks.claim-admission'], ['ATM-GOV-0190'], []),
  coverageNode('next-preflight-guard-doctor', 'next/preflight/guard/doctor', 'instrumented', ['next.route-resolution', 'doctor.readiness', 'guard.framework-mode'], ['ATM-GOV-0190'], []),
  coverageNode('validator-queue-execution-cache-fanout', 'validator queue/execution/cache/fan-out', 'not-yet-covered', [], ['ATM-GOV-0190'], ['validatorId', 'validatorVersion', 'durationMs', 'fanOutConsumerCount']),
  coverageNode('task-import-close-taskflow-checkpoint', 'task import/task close/taskflow close/checkpoint', 'instrumented', ['taskflow.close-readiness', 'batch.checkpoint-readiness'], ['ATM-GOV-0190'], []),
  coverageNode('evidence-seal-readback-handoff', 'evidence seal/readback/handoff', 'not-yet-covered', [], ['ATM-GOV-0190'], ['evidenceReadRef']),
  coverageNode('git-governance-hooks-branch-queue', 'git governance/pre-commit/pre-push/branch queue', 'read-only-summary', [], ['ATM-GOV-0190'], ['commitSha', 'branchRef']),
  coverageNode('runner-sync-release-projection', 'runner-sync/release mirror/generated projection', 'read-only-summary', [], ['ATM-GOV-0190'], ['runnerSyncReceiptRef']),
  coverageNode('batch-broker-team-worker-lifecycle', 'batch/broker/team/worker lifecycle', 'instrumented', ['batch.checkpoint-readiness', 'broker.shared-surface-admission'], ['ATM-GOV-0190'], []),
  coverageNode('telemetry-seal-report-self-health', 'telemetry seal/report/self-health', 'instrumented', ['telemetry.registry-coverage'], ['ATM-GOV-0190'], [])
]);

export function buildGateTelemetryRegistryCoverageReport(cwd: string): GateTelemetryRegistryCoverageReport {
  const historyEvents = readHistoryEvents(path.join(cwd, gateTelemetryHistoryRelativePath));
  const requiredNodes = canonicalGateTelemetryRequiredNodes;
  const m2Comparable = requiredNodes.every((node) => node.m2Comparable);
  return {
    schemaId: 'atm.gateTelemetryRegistryCoverageReport.v1',
    generatedAt: new Date().toISOString(),
    configDigest: digestJson({
      checks: canonicalGateCheckRegistry,
      requiredNodes: requiredNodes.map((node) => ({
        nodeId: node.nodeId,
        coverageStatus: node.coverageStatus,
        requiredCorrelationKeys: node.requiredCorrelationKeys
      }))
    }),
    historyDigest: digestJson({
      eventCount: historyEvents.valid.length,
      checkIds: [...new Set(historyEvents.valid.map((event) => event.checkId))].sort()
    }),
    requiredNodes,
    droppedEvents: 0,
    malformedEvents: historyEvents.malformed,
    m2Comparable,
    m2PreflightVerdict: m2Comparable ? 'ready' : 'inconclusive',
    rawDataPolicy: {
      runtimeStorage: '.atm/runtime/telemetry/**',
      trackedEvidence: 'compact-digest-only',
      rawTelemetryCommitted: false
    }
  };
}

export function buildGateTelemetryTaskSummary(cwd: string, input: {
  readonly taskId: string;
  readonly role?: GateTelemetryTaskSummary['baselineOrTreatmentRole'];
}): GateTelemetryTaskSummary {
  const historyEvents = readHistoryEvents(path.join(cwd, gateTelemetryHistoryRelativePath));
  const events = historyEvents.valid.filter((event) => event.taskId === input.taskId);
  const coverage = buildGateTelemetryRegistryCoverageReport(cwd);
  const report = reportEvents(events, historyEvents.malformed, historyEvents.warnings, 'sealed-history');
  const observed = events.map((event) => event.observedAt).sort();
  const missingTelemetry = coverage.requiredNodes.flatMap((node) => node.missingTelemetry);
  return {
    schemaId: 'atm.gateTelemetryTaskSummary.v1',
    taskId: input.taskId,
    generatedAt: new Date().toISOString(),
    window: {
      start: observed[0] ?? null,
      end: observed[observed.length - 1] ?? null,
      watermark: observed[observed.length - 1] ?? null
    },
    correlation: {
      runIds: sortedUnique(events.map((event) => event.runId)),
      laneSessionIds: sortedUnique(events.map((event) => event.laneSessionId ?? null)),
      batchIds: sortedUnique(events.map((event) => event.batchId ?? null)),
      waveIds: sortedUnique(events.map((event) => event.waveId ?? null))
    },
    gateEvents: report.byCheckId,
    uniqueBlocks: report.uniqueBlocks,
    truePositiveStatus: report.truePositiveStatus,
    evidenceReadbacks: Object.values(report.byCheckId).reduce((sum, bucket) => sum + bucket.evidenceReadbacks, 0),
    warnings: report.metaHealth.warnings,
    droppedEvents: report.metaHealth.droppedEvents,
    missingTelemetry,
    baselineOrTreatmentRole: input.role ?? 'unknown',
    sourceAvailability: missingTelemetry.length > 0 ? 'partial' : 'available',
    historyDigest: coverage.historyDigest,
    configDigest: coverage.configDigest
  };
}

export function emitGateTelemetryEvent(cwd: string, input: Partial<GateTelemetryEvent> & {
  readonly gate: string;
  readonly checkId: string;
  readonly result: GateTelemetryResult;
}): { ok: true; event: GateTelemetryEvent; path: string } | { ok: false; warning: string } {
  try {
    const now = input.observedAt ?? new Date().toISOString();
    const runId = input.runId ?? process.env.ATM_RUN_ID ?? `run-${process.pid}`;
    const sequence = input.sequence ?? Date.now();
    const lane = sanitizePathPart(input.laneSessionId ?? process.env.ATM_LANE_SESSION_ID ?? `process-${process.pid}`);
    const dir = path.join(cwd, gateTelemetryRuntimeRelativePath, 'gate-events', sanitizePathPart(runId));
    mkdirSync(dir, { recursive: true });
    const entry = registryEntryFor(input.checkId);
    const event: GateTelemetryEvent = {
      specVersion: gateTelemetrySpecVersion,
      eventId: input.eventId ?? `gte-${randomUUID()}`,
      sequence,
      observedAt: now,
      gate: input.gate,
      checkId: input.checkId,
      checkVersion: input.checkVersion ?? entry?.checkVersion ?? '1.0.0',
      policyVersion: input.policyVersion ?? '1.0.0',
      eligible: input.eligible ?? true,
      result: input.result,
      reasonClass: input.reasonClass ?? input.result,
      durationMs: Math.max(0, Math.trunc(input.durationMs ?? 0)),
      actorId: input.actorId ?? process.env.ATM_ACTOR_ID ?? 'unknown',
      runId,
      correlationId: input.correlationId ?? `corr-${randomUUID()}`,
      laneSessionId: input.laneSessionId ?? process.env.ATM_LANE_SESSION_ID ?? null,
      taskId: input.taskId ?? null,
      batchId: input.batchId ?? null,
      waveId: input.waveId ?? null,
      command: input.command ?? 'unknown',
      inputDigest: input.inputDigest ?? digestJson({ command: input.command ?? 'unknown', checkId: input.checkId }),
      configDigest: input.configDigest ?? digestJson({ registry: canonicalGateCheckRegistry.map((check) => check.checkId) }),
      source: input.source ?? 'runtime',
      redactionClass: input.redactionClass ?? 'none',
      failureEnvelopeRef: input.failureEnvelopeRef ?? null,
      evidenceReadRef: input.evidenceReadRef ?? null
    };
    const target = path.join(dir, `${lane}.jsonl`);
    writeFileSync(target, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
    return { ok: true, event, path: target };
  } catch (error) {
    return { ok: false, warning: error instanceof Error ? error.message : String(error) };
  }
}

export function sealGateTelemetry(cwd: string, input: {
  readonly taskId: string;
  readonly windowId?: string;
  readonly watermark?: string;
}): GateTelemetrySealDigest {
  const sealedAt = new Date().toISOString();
  const windowId = input.windowId ?? sealedAt.replace(/[:.]/g, '-');
  const watermark = input.watermark ?? sealedAt;
  const runtimeRoot = path.join(cwd, gateTelemetryRuntimeRelativePath, 'gate-events');
  const events = readRuntimeEvents(runtimeRoot, watermark);
  const historyDir = path.join(cwd, gateTelemetryHistoryRelativePath);
  const evidenceDir = path.join(cwd, gateTelemetryEvidenceRelativePath);
  mkdirSync(historyDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  const historyPath = path.join(historyDir, `gate-events-${sanitizePathPart(input.taskId)}-${sanitizePathPart(windowId)}.jsonl`);
  const body = events.valid.map((event) => JSON.stringify(event)).join('\n');
  writeFileSync(historyPath, body.length > 0 ? `${body}\n` : '', 'utf8');
  const historyDigest = digestText(readFileSync(historyPath, 'utf8'));
  const digest: GateTelemetrySealDigest = {
    schemaId: 'atm.gateTelemetrySealDigest.v1',
    taskId: input.taskId,
    windowId,
    sealedAt,
    watermark,
    eventCount: events.valid.length,
    historyPath: path.relative(cwd, historyPath).replace(/\\/g, '/'),
    historyDigest,
    metaHealth: {
      droppedEvents: 0,
      malformedEvents: events.malformed,
      warnings: events.warnings
    }
  };
  writeFileSync(path.join(evidenceDir, `${sanitizePathPart(windowId)}.json`), `${JSON.stringify(digest, null, 2)}\n`, 'utf8');
  return digest;
}

export function reportGateTelemetry(cwd: string, includeRuntime = false): GateTelemetryReport {
  const historyEvents = readHistoryEvents(path.join(cwd, gateTelemetryHistoryRelativePath));
  const runtimeEvents = includeRuntime ? readRuntimeEvents(path.join(cwd, gateTelemetryRuntimeRelativePath, 'gate-events')).valid : [];
  const events = [...historyEvents.valid, ...runtimeEvents];
  return reportEvents(events, historyEvents.malformed, historyEvents.warnings, includeRuntime ? 'sealed-history+runtime' : 'sealed-history');
}

function reportEvents(
  events: readonly GateTelemetryEvent[],
  malformedEvents: number,
  warnings: readonly string[],
  source: GateTelemetryReport['source']
): GateTelemetryReport {
  const byCheckId: GateTelemetryReport['byCheckId'] = {};
  const uniqueBlocks = new Set<string>();
  for (const event of events) {
    const bucket = byCheckId[event.checkId] ?? {
      eligible: 0,
      resultCounts: {},
      durationP50: null,
      durationP95: null,
      evidenceReadbacks: 0
    };
    const durations = events.filter((candidate) => candidate.checkId === event.checkId).map((candidate) => candidate.durationMs).sort((a, b) => a - b);
    byCheckId[event.checkId] = {
      eligible: bucket.eligible + (event.eligible ? 1 : 0),
      resultCounts: { ...bucket.resultCounts, [event.result]: (bucket.resultCounts[event.result] ?? 0) + 1 },
      durationP50: percentile(durations, 0.5),
      durationP95: percentile(durations, 0.95),
      evidenceReadbacks: bucket.evidenceReadbacks + (event.evidenceReadRef ? 1 : 0)
    };
    if (event.result === 'block') uniqueBlocks.add(`${event.checkId}:${event.reasonClass}:${event.inputDigest}`);
  }
  return {
    schemaId: 'atm.gateTelemetryReport.v1',
    generatedAt: new Date().toISOString(),
    source,
    eventCount: events.length,
    byCheckId,
    uniqueBlocks: [...uniqueBlocks].sort(),
    truePositiveStatus: 'unclassified',
    metaHealth: {
      droppedEvents: 0,
      malformedEvents,
      warnings
    }
  };
}

function registryEntryFor(checkId: string): GateCheckRegistryEntry | null {
  return canonicalGateCheckRegistry.find((entry) => entry.checkId === checkId) ?? null;
}

function coverageNode(
  nodeId: string,
  nodeFamily: string,
  coverageStatus: GateTelemetryCoverageStatus,
  producerCheckIds: readonly string[],
  consumerIds: readonly string[],
  missingTelemetry: readonly string[]
): GateTelemetryRequiredNodeCoverage {
  const requiredCorrelationKeys = ['runId', 'laneSessionId', 'taskId', 'configDigest'];
  return {
    nodeId,
    nodeFamily,
    coverageStatus,
    producerCheckIds,
    consumerIds,
    requiredCorrelationKeys,
    missingCorrelationKeys: missingTelemetry.length > 0 ? requiredCorrelationKeys : [],
    sourceAvailability: coverageStatus === 'instrumented' ? 'available' : coverageStatus === 'out-of-scope' ? 'unavailable' : 'partial',
    missingTelemetry,
    m2Comparable: coverageStatus === 'instrumented' || coverageStatus === 'out-of-scope'
  };
}

function readRuntimeEvents(root: string, watermark?: string): { valid: GateTelemetryEvent[]; malformed: number; warnings: string[] } {
  return readEventTree(root, watermark);
}

function readHistoryEvents(root: string): { valid: GateTelemetryEvent[]; malformed: number; warnings: string[] } {
  return readEventTree(root);
}

function readEventTree(root: string, watermark?: string): { valid: GateTelemetryEvent[]; malformed: number; warnings: string[] } {
  if (!existsSync(root)) return { valid: [], malformed: 0, warnings: [] };
  const files = listJsonlFiles(root);
  const valid: GateTelemetryEvent[] = [];
  let malformed = 0;
  const warnings: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as GateTelemetryEvent;
        if (event.specVersion !== gateTelemetrySpecVersion) {
          malformed += 1;
          continue;
        }
        if (watermark && event.observedAt > watermark) continue;
        valid.push(event);
      } catch {
        malformed += 1;
      }
    }
  }
  valid.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.sequence - b.sequence);
  return { valid, malformed, warnings };
}

function listJsonlFiles(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const full = path.join(root, name);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      out.push(...listJsonlFiles(full));
    } else if (name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
  return out;
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1));
  return values[index] ?? null;
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120) || 'unknown';
}

function digestJson(value: unknown): string {
  return digestText(JSON.stringify(value));
}

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sortedUnique(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))].sort();
}
