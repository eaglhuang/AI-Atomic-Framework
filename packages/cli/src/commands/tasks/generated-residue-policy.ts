import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type GeneratedResidueLifecycleAction = 'release' | 'abandon' | null;

export interface GeneratedResidueTaskDisposition {
  readonly status: string | null;
  readonly claimState: string | null;
  readonly lastLifecycleAction: GeneratedResidueLifecycleAction;
  readonly hasActiveClaim: boolean;
}

function readJson(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const value = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalize(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

function latestLifecycleAction(cwd: string, taskId: string): GeneratedResidueLifecycleAction {
  const directory = path.join(cwd, '.atm', 'history', 'task-events', taskId);
  if (!existsSync(directory)) return null;
  const candidates = readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => {
      const event = readJson(path.join(directory, entry));
      const action = normalize(event?.action ?? event?.eventType ?? event?.transition);
      if (action !== 'release' && action !== 'abandon') return null;
      const timestamp = String(event?.createdAt ?? event?.timestamp ?? event?.at ?? '');
      return { action, timestamp };
    })
    .filter((entry): entry is { action: 'release' | 'abandon'; timestamp: string } => Boolean(entry))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  return candidates[0]?.action ?? null;
}

export function readGeneratedResidueTaskDisposition(cwd: string, taskId: string): GeneratedResidueTaskDisposition | null {
  if (!cwd || !taskId) return null;
  const normalizedTaskId = taskId.trim().toUpperCase();
  const ledger = readJson(path.join(cwd, '.atm', 'history', 'tasks', `${normalizedTaskId}.json`));
  if (!ledger) return null;
  const claim = ledger.claim && typeof ledger.claim === 'object' && !Array.isArray(ledger.claim)
    ? ledger.claim as Record<string, unknown>
    : null;
  const claimState = normalize(claim?.state);
  return {
    status: normalize(ledger.status),
    claimState,
    lastLifecycleAction: latestLifecycleAction(cwd, normalizedTaskId),
    hasActiveClaim: claimState === 'active' || claimState === 'claimed' || Boolean(claim?.owner),
  };
}

export function isReleasedGeneratedBundleSafeToClean(
  disposition: GeneratedResidueTaskDisposition | null,
): boolean {
  if (!disposition || disposition.hasActiveClaim) return false;
  if (disposition.lastLifecycleAction !== 'release' && disposition.lastLifecycleAction !== 'abandon') return false;
  return disposition.status !== 'running' && disposition.status !== 'review';
}
