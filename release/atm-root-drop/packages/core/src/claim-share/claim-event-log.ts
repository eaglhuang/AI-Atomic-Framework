/**
 * Append-only claim event log (prereg v3 W4).
 * One JSON object per line in `.atm/runtime/claim-events.jsonl`.
 * Lines are only ever appended with O_APPEND; nothing in ATM rewrites or truncates this file.
 * Each event carries a wall-clock ISO stamp (`at`) and a CLOCK_MONOTONIC stamp (`monoNs`)
 * so notice latency can be measured even across wall-clock steps.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const claimEventLogRelativePath = path.join('.atm', 'runtime', 'claim-events.jsonl');

export type ClaimEventType =
  | 'claim'
  | 'claim-overlap'
  | 'overlap-notice-delivered'
  | 'renew'
  | 'expire'
  | 'release'
  | 'unclaimed-write'
  | 'steward-accept'
  | 'steward-reject';

export interface ClaimEvent {
  readonly schemaId: 'atm.claimEvent.v1';
  readonly seq: number;
  readonly at: string;
  readonly monoNs: string;
  readonly type: ClaimEventType;
  readonly actorId: string;
  readonly claimId: string | null;
  readonly files: readonly string[];
  readonly relatedClaimIds: readonly string[];
  readonly detail: Record<string, unknown>;
}

export interface ClaimEventInput {
  readonly type: ClaimEventType;
  readonly actorId: string;
  readonly claimId?: string | null;
  readonly files?: readonly string[];
  readonly relatedClaimIds?: readonly string[];
  readonly detail?: Record<string, unknown>;
}

export function claimEventLogPath(cwd: string): string {
  return path.join(cwd, claimEventLogRelativePath);
}

/** Appends one event. Callers must hold the claim-share lock so `seq` stays strictly increasing. */
export function appendClaimEvent(cwd: string, seq: number, nowMs: number, input: ClaimEventInput): ClaimEvent {
  const event: ClaimEvent = {
    schemaId: 'atm.claimEvent.v1',
    seq,
    at: new Date(nowMs).toISOString(),
    monoNs: process.hrtime.bigint().toString(),
    type: input.type,
    actorId: input.actorId,
    claimId: input.claimId ?? null,
    files: [...(input.files ?? [])],
    relatedClaimIds: [...(input.relatedClaimIds ?? [])],
    detail: { ...(input.detail ?? {}) }
  };
  const logPath = claimEventLogPath(cwd);
  mkdirSync(path.dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
  return event;
}

export function readClaimEvents(cwd: string): ClaimEvent[] {
  const logPath = claimEventLogPath(cwd);
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ClaimEvent);
}
