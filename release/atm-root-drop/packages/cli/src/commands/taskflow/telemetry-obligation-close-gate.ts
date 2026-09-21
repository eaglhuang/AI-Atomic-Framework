import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildGateTelemetryTaskSummary,
  type GateTelemetryTaskSummary
} from '../../../../core/src/telemetry/index.ts';
import {
  evaluateTelemetryObligationSeal,
  type TelemetryObligationSealResult
} from '../../../../core/src/broker/replay/lifecycle-receipts.ts';

export type TaskflowTelemetryObligationGate = {
  readonly declared: boolean;
  readonly result: TelemetryObligationSealResult | null;
  readonly summary: GateTelemetryTaskSummary | null;
};

const TELEMETRY_SUMMARY_SCHEMA = 'atm.gateTelemetryTaskSummary.v1';
const TELEMETRY_SEAL_SCHEMA = 'atm.gateTelemetrySealDigest.v1';

export function evaluateTaskflowTelemetryObligationGate(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly taskDocument: Record<string, unknown>;
}): TaskflowTelemetryObligationGate {
  const declaredObligations = readDeclaredObligations(input.taskDocument);
  if (declaredObligations.length === 0) {
    return { declared: false, result: null, summary: null };
  }

  const unavailableReceiptDigest = readUnavailableReceiptDigest(input.taskDocument);
  const seal = readTaskSeal(input.cwd, input.taskId);
  let summary: GateTelemetryTaskSummary | null = null;
  let sealedSummaryDigest: string | null = null;
  let historyDigest: string | null = null;
  let configDigest: string | null = null;
  if (seal) {
    try {
      summary = buildGateTelemetryTaskSummary(input.cwd, { taskId: input.taskId });
      sealedSummaryDigest = summary.sealedDigest;
      historyDigest = summary.historyDigest;
      configDigest = summary.configDigest;
    } catch {
      summary = null;
    }
  }

  return {
    declared: true,
    summary,
    result: evaluateTelemetryObligationSeal({
      taskId: input.taskId,
      declaredObligations,
      sealedSummaryDigest,
      unavailableReceiptDigest,
      historyDigest,
      configDigest
    })
  };
}

function readDeclaredObligations(taskDocument: Record<string, unknown>): string[] {
  const candidates: unknown[] = [
    taskDocument.telemetryObligations,
    taskDocument.telemetryContract && typeof taskDocument.telemetryContract === 'object'
      ? (taskDocument.telemetryContract as Record<string, unknown>).declaredObligations
      : null,
    taskDocument.telemetry && typeof taskDocument.telemetry === 'object'
      ? (taskDocument.telemetry as Record<string, unknown>).declaredObligations
      : null
  ];
  const explicit = candidates.flatMap((value) => Array.isArray(value) ? value : [])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
  if (explicit.length > 0) return [...new Set(explicit)];

  // Imported planning cards predate the machine-readable projection. Preserve
  // their declared contract without treating arbitrary telemetry prose as a
  // close obligation: only the canonical summary schema is recognized.
  const text = [taskDocument.description, taskDocument.intent, taskDocument.notes, taskDocument.acceptance]
    .map((value) => typeof value === 'string' ? value : JSON.stringify(value ?? ''))
    .join('\n');
  return text.includes(TELEMETRY_SUMMARY_SCHEMA) ? [TELEMETRY_SUMMARY_SCHEMA] : [];
}

function readUnavailableReceiptDigest(taskDocument: Record<string, unknown>): string | null {
  const telemetry = taskDocument.telemetryObligationSeal;
  const candidates = [
    taskDocument.telemetryUnavailableReceiptDigest,
    telemetry && typeof telemetry === 'object'
      ? (telemetry as Record<string, unknown>).unavailableReceiptDigest
      : null
  ];
  const digest = candidates.find((value): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value));
  return digest ?? null;
}

function readTaskSeal(cwd: string, taskId: string): Record<string, unknown> | null {
  const root = path.join(cwd, '.atm', 'runtime', 'telemetry', 'evidence');
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const value = JSON.parse(readFileSync(path.join(root, entry.name), 'utf8')) as Record<string, unknown>;
      if (value.schemaId === TELEMETRY_SEAL_SCHEMA && value.taskId === taskId) return value;
    } catch {
      // A malformed or unrelated runtime artifact is not evidence of a seal.
    }
  }
  return null;
}
