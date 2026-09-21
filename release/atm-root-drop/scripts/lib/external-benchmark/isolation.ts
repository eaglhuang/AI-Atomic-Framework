import { createHash } from 'node:crypto';

export type IsolationStrength = 'worktree-only' | 'isolated-internal' | 'external-ready';
export interface EnvironmentSpec {
  readonly runId: string; readonly repository: string; readonly commitSha: string;
  readonly osImageDigest: string; readonly toolchainDigest: string;
  readonly arm: 'baseline' | 'atm'; readonly packageTarballDigest: string | null;
  readonly mounts: { readonly readable: readonly string[]; readonly denied: readonly string[] };
  readonly negativeControls: readonly { readonly target: string; readonly blocked: boolean; readonly observedAt: string }[];
}
export interface CleanupReceipt { readonly receiptId: string; readonly owner: string; readonly operationId: string; readonly paths: readonly string[]; readonly pathDigests: Readonly<Record<string, string>>; readonly status: 'pending' | 'cleaned' }

const digest = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
export function validateEnvironment(spec: EnvironmentSpec): { readonly ok: boolean; readonly strength: IsolationStrength; readonly violations: readonly string[]; readonly digest: string } {
  const violations: string[] = [];
  if (!spec.runId || !spec.repository || !/^[a-f0-9]{40}$/.test(spec.commitSha)) violations.push('sealed repository identity is missing');
  if (!/^sha256:[a-f0-9]{64}$/.test(spec.osImageDigest) || !/^sha256:[a-f0-9]{64}$/.test(spec.toolchainDigest)) violations.push('OS/toolchain digest is not sealed');
  if (spec.arm === 'atm' && !/^sha256:[a-f0-9]{64}$/.test(spec.packageTarballDigest ?? '')) violations.push('ATM arm requires pinned public tarball digest');
  if (spec.arm === 'baseline' && spec.packageTarballDigest !== null) violations.push('baseline must not load ATM package');
  const denied = new Set(spec.mounts.denied);
  for (const target of ['oracle', 'other-run', 'framework-workspace', 'home-credentials']) if (!denied.has(target)) violations.push(`missing denied mount: ${target}`);
  if (!spec.negativeControls.length || spec.negativeControls.some(control => !control.blocked)) violations.push('negative controls did not all observe denied access');
  const strength: IsolationStrength = violations.length ? 'worktree-only' : spec.mounts.readable.includes('external-custodian') ? 'external-ready' : 'isolated-internal';
  return { ok: violations.length === 0, strength, violations, digest: digest(spec) };
}
export function createCleanupReceipt(operationId: string, owner: string, paths: readonly string[], pathDigests: Readonly<Record<string, string>>): CleanupReceipt {
  if (!operationId || !owner || paths.length === 0 || paths.some(path => !path || !pathDigests[path])) throw new Error('cleanup receipt requires owner-bound paths and digests');
  return { receiptId: digest({ operationId, owner, paths, pathDigests }), operationId, owner, paths: [...paths], pathDigests: { ...pathDigests }, status: 'pending' };
}
export function authorizeCleanup(receipt: CleanupReceipt, observed: Readonly<Record<string, string>>, owner: string): CleanupReceipt {
  if (receipt.status !== 'pending' || receipt.owner !== owner) throw new Error('cleanup receipt owner or state mismatch');
  for (const path of receipt.paths) if (observed[path] !== receipt.pathDigests[path]) throw new Error(`cleanup path changed or is not receipt-owned: ${path}`);
  return { ...receipt, status: 'cleaned' };
}
