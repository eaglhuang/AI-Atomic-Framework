/**
 * Registry for the file-level claim share layer (prereg v3 W4).
 * Kept apart from the write-broker registry on purpose: broker decisions (queue / compose)
 * never read this file, so HIST-v2 behaviour is unchanged.
 * The layer is active only after `broker claim init` creates the registry.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { acquireKernelAdvisoryLock, releaseKernelAdvisoryLock } from '../broker/steward-kernel-lock.ts';

export const claimShareRegistryRelativePath = path.join('.atm', 'runtime', 'claim-share.registry.json');
export const claimShareLockRelativePath = path.join('.atm', 'runtime', 'claim-share.lock');
export const defaultClaimTtlSeconds = 900;

export interface ShareClaim {
  readonly claimId: string;
  readonly actorId: string;
  readonly files: readonly string[];
  readonly source: 'claim' | 'unclaimed-write';
  readonly claimedAt: string;
  readonly renewedAt: string;
  readonly expiresAt: string;
  readonly ttlSeconds: number;
}

export interface PendingOverlapNotice {
  readonly noticeId: string;
  readonly holderActorId: string;
  readonly holderClaimId: string;
  readonly files: readonly string[];
  readonly createdAt: string;
  readonly causeSeq: number;
}

export interface ClaimShareRegistry {
  readonly schemaId: 'atm.claimShareRegistry.v1';
  nextSeq: number;
  nextClaimNumber: number;
  claims: ShareClaim[];
  pendingNotices: PendingOverlapNotice[];
}

export function claimShareRegistryPath(cwd: string): string {
  return path.join(cwd, claimShareRegistryRelativePath);
}

export function isClaimShareActive(cwd: string): boolean {
  return existsSync(claimShareRegistryPath(cwd));
}

export function emptyClaimShareRegistry(): ClaimShareRegistry {
  return { schemaId: 'atm.claimShareRegistry.v1', nextSeq: 1, nextClaimNumber: 1, claims: [], pendingNotices: [] };
}

export function loadClaimShareRegistry(cwd: string): ClaimShareRegistry {
  const registryPath = claimShareRegistryPath(cwd);
  if (!existsSync(registryPath)) return emptyClaimShareRegistry();
  const parsed = JSON.parse(readFileSync(registryPath, 'utf8')) as Partial<ClaimShareRegistry>;
  return {
    schemaId: 'atm.claimShareRegistry.v1',
    nextSeq: Number.isInteger(parsed.nextSeq) ? Number(parsed.nextSeq) : 1,
    nextClaimNumber: Number.isInteger(parsed.nextClaimNumber) ? Number(parsed.nextClaimNumber) : 1,
    claims: Array.isArray(parsed.claims) ? [...parsed.claims] : [],
    pendingNotices: Array.isArray(parsed.pendingNotices) ? [...parsed.pendingNotices] : []
  };
}

export function saveClaimShareRegistry(cwd: string, registry: ClaimShareRegistry): void {
  const registryPath = claimShareRegistryPath(cwd);
  mkdirSync(path.dirname(registryPath), { recursive: true });
  const temporaryPath = `${registryPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, registryPath);
}

/** Runs `fn` under the cross-process kernel advisory lock that guards both the registry and the event log. */
export function withClaimShareLock<T>(cwd: string, fn: () => T): T {
  const lockDir = path.join(cwd, claimShareLockRelativePath);
  acquireKernelAdvisoryLock(lockDir, 30_000, 5, claimShareRegistryRelativePath);
  try {
    return fn();
  } finally {
    releaseKernelAdvisoryLock(lockDir);
  }
}
