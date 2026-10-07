import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Per-file temperature from inter-arrival gaps between write intents (issue #184).
 *
 * Temperature only biases how often a path takes the hot (proposal-first) lane.
 * It never overrides true-conflict, lease, or CAS gates.
 */

export const DEFAULT_FILE_HEAT_RELATIVE_PATH = '.atm/runtime/file-heat.json';
export const LEGACY_HOT_FILE_BASENAMES: ReadonlySet<string> = new Set(['tasks.ts', 'next.ts', 'evidence.ts', 'hook.ts', 'team.ts', 'broker.ts']);
export const LEARNED_MODE_LEGACY_PRIOR = 65;
export const FILE_HEAT_POLICY_DIGEST = 'file-heat.v1';

export type FileHeatMode = 'static' | 'hybrid' | 'learned';

export interface FileHeatEntry {
  readonly temperature: number;
  readonly lastTouchAt: string;
  readonly lastActorId: string;
}

export interface FileHeatLedger {
  readonly schemaId: 'atm.fileHeatLedger.v1';
  readonly specVersion: '0.1.0';
  readonly entries: Readonly<Record<string, FileHeatEntry>>;
}

export interface FileHeatFileReceipt {
  readonly path: string;
  readonly temperature: number;
  readonly pHot: number;
  readonly hot: boolean;
}

export interface FileHeatReceipt {
  readonly schemaId: 'atm.fileHeatReceipt.v1';
  readonly mode: FileHeatMode;
  readonly policyDigest: string;
  readonly files: readonly FileHeatFileReceipt[];
}

/** Gap table: closer successive touches by distinct actors heat faster. */
const HEAT_BUMP_TABLE: readonly { readonly belowMs: number; readonly bump: number }[] = [
  { belowMs: 2_000, bump: 100 },
  { belowMs: 3_000, bump: 50 },
  { belowMs: 5_000, bump: 20 },
  { belowMs: 10_000, bump: 10 },
  { belowMs: 15_000, bump: 5 }
];

/** Idle cool-down: nothing for the first minute, then T *= 0.9 per five idle minutes. */
export const COOL_IDLE_FLOOR_MS = 60_000;
export const COOL_WINDOW_MS = 5 * 60_000;
export const COOL_FACTOR_PER_WINDOW = 0.9;

export function createEmptyFileHeatLedger(): FileHeatLedger {
  return { schemaId: 'atm.fileHeatLedger.v1', specVersion: '0.1.0', entries: {} };
}

export function resolveFileHeatMode(value: string | undefined = process.env.ATM_HEAT_MODE): FileHeatMode {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === 'static' || normalized === 'learned' ? normalized : 'hybrid';
}

export function heatBumpForGap(deltaMs: number): number {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return 0;
  for (const row of HEAT_BUMP_TABLE) {
    if (deltaMs < row.belowMs) return row.bump;
  }
  return 0;
}

export function coolTemperature(temperature: number, idleMs: number): number {
  if (!Number.isFinite(idleMs) || idleMs <= COOL_IDLE_FLOOR_MS) return clampTemperature(temperature);
  const windows = Math.floor((idleMs - COOL_IDLE_FLOOR_MS) / COOL_WINDOW_MS);
  return clampTemperature(temperature * COOL_FACTOR_PER_WINDOW ** windows);
}

export function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Record one write-intent touch. Heat rises only when the previous touch came from a
 * different actor; a single actor saving rapidly stays on the cold path.
 */
export function recordFileTouch(
  ledger: FileHeatLedger,
  input: { readonly path: string; readonly actorId: string; readonly now: Date }
): FileHeatLedger {
  const key = normalizeHeatPath(input.path);
  const previous = ledger.entries[key];
  let temperature = 0;
  if (previous) {
    const deltaMs = input.now.getTime() - Date.parse(previous.lastTouchAt);
    temperature = coolTemperature(previous.temperature, deltaMs);
    if (previous.lastActorId !== input.actorId) {
      temperature = clampTemperature(temperature + heatBumpForGap(deltaMs));
    }
  }
  return {
    ...ledger,
    entries: {
      ...ledger.entries,
      [key]: { temperature, lastTouchAt: input.now.toISOString(), lastActorId: input.actorId }
    }
  };
}

/** Learned temperature as of `now`, after idle cool-down. */
export function readLearnedTemperature(ledger: FileHeatLedger, filePath: string, now: Date): number {
  const entry = ledger.entries[normalizeHeatPath(filePath)];
  if (!entry) return 0;
  return coolTemperature(entry.temperature, now.getTime() - Date.parse(entry.lastTouchAt));
}

export function resolveEffectiveTemperature(input: {
  readonly mode: FileHeatMode;
  readonly ledger: FileHeatLedger;
  readonly path: string;
  readonly now: Date;
}): number {
  const legacyHot = LEGACY_HOT_FILE_BASENAMES.has(path.posix.basename(normalizeHeatPath(input.path)));
  if (input.mode === 'static') return legacyHot ? 100 : 0;
  const learned = readLearnedTemperature(input.ledger, input.path, input.now);
  if (input.mode === 'hybrid') return legacyHot ? 100 : learned;
  const hasHistory = Boolean(input.ledger.entries[normalizeHeatPath(input.path)]);
  return hasHistory ? learned : legacyHot ? LEARNED_MODE_LEGACY_PRIOR : 0;
}

/** Stable Bernoulli draw on p_hot = T / 100 so a given task/path/policy always routes the same way. */
export function decideHotPath(input: {
  readonly temperature: number;
  readonly taskId: string;
  readonly path: string;
  readonly policyDigest?: string;
}): boolean {
  const pHot = clampTemperature(input.temperature) / 100;
  if (pHot <= 0) return false;
  if (pHot >= 1) return true;
  const digest = createHash('sha256')
    .update(`${input.taskId}‖${normalizeHeatPath(input.path)}‖${input.policyDigest ?? FILE_HEAT_POLICY_DIGEST}`)
    .digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000 < pHot;
}

export function buildFileHeatReceipt(input: {
  readonly mode: FileHeatMode;
  readonly ledger: FileHeatLedger;
  readonly taskId: string;
  readonly paths: readonly string[];
  readonly now: Date;
}): FileHeatReceipt {
  return {
    schemaId: 'atm.fileHeatReceipt.v1',
    mode: input.mode,
    policyDigest: FILE_HEAT_POLICY_DIGEST,
    files: input.paths.map((filePath) => {
      const temperature = roundTemperature(resolveEffectiveTemperature({ mode: input.mode, ledger: input.ledger, path: filePath, now: input.now }));
      return {
        path: filePath,
        temperature,
        pHot: temperature / 100,
        hot: decideHotPath({ temperature, taskId: input.taskId, path: filePath })
      };
    })
  };
}

export function loadFileHeatLedger(ledgerPath: string): FileHeatLedger {
  if (!existsSync(ledgerPath)) return createEmptyFileHeatLedger();
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Partial<FileHeatLedger> | null;
    if (parsed?.schemaId !== 'atm.fileHeatLedger.v1' || typeof parsed.entries !== 'object' || parsed.entries === null) {
      return createEmptyFileHeatLedger();
    }
    const entries: Record<string, FileHeatEntry> = {};
    for (const [key, value] of Object.entries(parsed.entries)) {
      const entry = value as Partial<FileHeatEntry> | null;
      if (typeof entry?.temperature !== 'number' || typeof entry.lastTouchAt !== 'string' || typeof entry.lastActorId !== 'string') continue;
      if (Number.isNaN(Date.parse(entry.lastTouchAt))) continue;
      entries[key] = { temperature: clampTemperature(entry.temperature), lastTouchAt: entry.lastTouchAt, lastActorId: entry.lastActorId };
    }
    return { ...createEmptyFileHeatLedger(), entries };
  } catch {
    return createEmptyFileHeatLedger();
  }
}

export function saveFileHeatLedger(ledgerPath: string, ledger: FileHeatLedger): void {
  mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const tempPath = `${ledgerPath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  renameSync(tempPath, ledgerPath);
}

function normalizeHeatPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function roundTemperature(value: number): number {
  return Math.round(value * 100) / 100;
}
