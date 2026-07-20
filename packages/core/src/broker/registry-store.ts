import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import type { WriteBrokerRegistryDocument } from './types.ts';

export type BrokerRegistryRecoveryKind =
  | 'missing'
  | 'invalid-json'
  | 'invalid-shape'
  | 'checksum-mismatch'
  | 'stale-generation';

export interface BrokerRegistryRecoveryFact {
  readonly schemaId: 'atm.brokerRegistryRecoveryFact.v1';
  readonly kind: BrokerRegistryRecoveryKind;
  readonly registryPath: string;
  readonly message: string;
  readonly failClosed: true;
  readonly observedDigest?: string;
  readonly expectedDigest?: string;
  readonly generation?: number | null;
}

export interface BrokerRegistrySnapshot {
  readonly schemaId: 'atm.brokerRegistrySnapshot.v1';
  readonly registryPath: string;
  readonly generation: number;
  readonly digest: string;
  readonly lastTransactionId: string | null;
  readonly document: WriteBrokerRegistryDocument;
}

export interface BrokerRegistryWriteReceipt {
  readonly schemaId: 'atm.brokerRegistryWriteReceipt.v1';
  readonly transactionId: string;
  readonly registryPath: string;
  readonly baseGeneration: number;
  readonly nextGeneration: number;
  readonly baseDigest: string;
  readonly nextDigest: string;
  readonly committedAt: string;
}

export interface BrokerRegistryStore {
  readonly registryPath: string;
  read(): BrokerRegistrySnapshot;
  write(input: {
    readonly base: BrokerRegistrySnapshot;
    readonly next: WriteBrokerRegistryDocument;
    readonly transactionId: string;
    readonly now?: string;
  }): BrokerRegistryWriteReceipt;
}

export class BrokerRegistryStoreError extends Error {
  readonly code: string;
  readonly recoveryFact: BrokerRegistryRecoveryFact;

  constructor(code: string, recoveryFact: BrokerRegistryRecoveryFact) {
    super(`${code}: ${recoveryFact.message}`);
    this.name = 'BrokerRegistryStoreError';
    this.code = code;
    this.recoveryFact = recoveryFact;
  }
}

export function createEmptyBrokerRegistryDocument(input: {
  readonly currentEpoch?: number;
  readonly repoId?: string;
  readonly workspaceId?: string;
} = {}): WriteBrokerRegistryDocument {
  return {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: input.repoId ?? 'local-repo',
    workspaceId: input.workspaceId ?? 'main',
    currentEpoch: input.currentEpoch ?? Date.now(),
    activeIntents: []
  };
}

export function createBrokerRegistryStore(registryPath: string): BrokerRegistryStore {
  return {
    registryPath,
    read: () => readBrokerRegistrySnapshot(registryPath),
    write: (input) => writeBrokerRegistrySnapshot(registryPath, input)
  };
}

export function readBrokerRegistrySnapshot(registryPath: string): BrokerRegistrySnapshot {
  if (!existsSync(registryPath)) {
    const document = createEmptyBrokerRegistryDocument();
    return {
      schemaId: 'atm.brokerRegistrySnapshot.v1',
      registryPath,
      generation: document.currentEpoch ?? 0,
      digest: digestRegistryDocument(document),
      lastTransactionId: null,
      document
    };
  }

  let parsed: unknown;
  const raw = readFileSync(registryPath, 'utf8');
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw registryStoreError('ATM_BROKER_REGISTRY_INVALID_JSON', {
      kind: 'invalid-json',
      registryPath,
      message: `Broker registry is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`
    });
  }

  if (!isRegistryDocument(parsed)) {
    throw registryStoreError('ATM_BROKER_REGISTRY_INVALID_SHAPE', {
      kind: 'invalid-shape',
      registryPath,
      message: 'Broker registry must be an atm.writeBrokerRegistry.v1 object with activeIntents.'
    });
  }

  const digest = digestRegistryDocument(parsed);
  const generation = Number.isFinite(parsed.currentEpoch) ? Number(parsed.currentEpoch) : 0;
  const lastTransactionId = typeof (parsed as { lastTransactionId?: unknown }).lastTransactionId === 'string'
    ? String((parsed as { lastTransactionId?: unknown }).lastTransactionId)
    : null;

  return {
    schemaId: 'atm.brokerRegistrySnapshot.v1',
    registryPath,
    generation,
    digest,
    lastTransactionId,
    document: parsed
  };
}

export function writeBrokerRegistrySnapshot(
  registryPath: string,
  input: {
    readonly base: BrokerRegistrySnapshot;
    readonly next: WriteBrokerRegistryDocument;
    readonly transactionId: string;
    readonly now?: string;
  }
): BrokerRegistryWriteReceipt {
  const current = existsSync(registryPath) ? readBrokerRegistrySnapshot(registryPath) : input.base;
  if (current.digest !== input.base.digest || current.generation !== input.base.generation) {
    throw registryStoreError('ATM_BROKER_REGISTRY_CAS_CONFLICT', {
      kind: 'stale-generation',
      registryPath,
      message: `Broker registry CAS rejected stale generation ${input.base.generation}; current generation is ${current.generation}.`,
      observedDigest: current.digest,
      expectedDigest: input.base.digest,
      generation: current.generation
    });
  }

  const nextGeneration = Math.max(Date.now(), input.base.generation + 1);
  const next = {
    ...input.next,
    currentEpoch: nextGeneration,
    lastTransactionId: input.transactionId
  } as WriteBrokerRegistryDocument & { readonly lastTransactionId: string };
  const nextDigest = digestRegistryDocument(next);
  writeAtomicUtf8(registryPath, `${JSON.stringify(next, null, 2)}\n`);

  return {
    schemaId: 'atm.brokerRegistryWriteReceipt.v1',
    transactionId: input.transactionId,
    registryPath,
    baseGeneration: input.base.generation,
    nextGeneration,
    baseDigest: input.base.digest,
    nextDigest,
    committedAt: input.now ?? new Date().toISOString()
  };
}

export function digestRegistryDocument(document: WriteBrokerRegistryDocument): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(document))).digest('hex')}`;
}

function isRegistryDocument(value: unknown): value is WriteBrokerRegistryDocument {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as { schemaId?: unknown }).schemaId === 'atm.writeBrokerRegistry.v1'
    && (value as { specVersion?: unknown }).specVersion === '0.1.0'
    && Array.isArray((value as { activeIntents?: unknown }).activeIntents)
  );
}

function registryStoreError(
  code: string,
  input: Omit<BrokerRegistryRecoveryFact, 'schemaId' | 'failClosed'>
): BrokerRegistryStoreError {
  return new BrokerRegistryStoreError(code, {
    schemaId: 'atm.brokerRegistryRecoveryFact.v1',
    failClosed: true,
    ...input
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
}

function writeAtomicUtf8(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, 'wx');
    writeFileSync(fd, content, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tempPath, filePath);
    fsyncDirectory(dir);
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Best effort cleanup after a failed atomic registry write.
      }
    }
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function fsyncDirectory(dir: string): void {
  let fd: number | null = null;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch {
    // Directory fsync is not available on every host filesystem.
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
