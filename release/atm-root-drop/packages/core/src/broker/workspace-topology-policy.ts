/**
 * The topology guard deliberately knows nothing about Git commands or broker
 * scheduling.  A physical file overlap is a logical-intent decision; Git
 * topology must not become a second arbitration mechanism.
 */
export type WorkspaceTopologyPurpose =
  | 'normal-development'
  | 'emergency-anomaly-recovery'
  | 'historical-read-only-discrimination'
  | 'non-development-sealed-packaging';

export type WorkspaceTopologyOperation = 'submit-proposal' | 'apply-shared-delivery' | 'read-only';

export type WorkspaceTopologyVerdict =
  | 'canonical-development'
  | 'documented-exception'
  | 'rejected-noncanonical-development'
  | 'rejected-direct-worker-write'
  | 'rejected-missing-exception-receipt'
  | 'rejected-unsupported-purpose';

export interface WorkspaceTopologyPolicyInput {
  readonly canonicalWorktreeRoot: string;
  readonly executionWorktreeRoot: string;
  readonly purpose: WorkspaceTopologyPurpose;
  readonly operation: WorkspaceTopologyOperation;
  readonly actorRole: 'worker' | 'neutral-steward';
  readonly exceptionReceiptId?: string | null;
}

export interface WorkspaceTopologyPolicyDecision {
  readonly allowed: boolean;
  readonly verdict: WorkspaceTopologyVerdict;
  readonly reason: string;
}

const exceptionPurposes = new Set<WorkspaceTopologyPurpose>([
  'emergency-anomaly-recovery',
  'historical-read-only-discrimination',
  'non-development-sealed-packaging'
]);

export function evaluateWorkspaceTopologyPolicy(
  input: WorkspaceTopologyPolicyInput
): WorkspaceTopologyPolicyDecision {
  const sameCanonicalRoot = normalizeRoot(input.canonicalWorktreeRoot) === normalizeRoot(input.executionWorktreeRoot);

  if (input.purpose === 'normal-development') {
    if (!sameCanonicalRoot) {
      return rejected(
        'rejected-noncanonical-development',
        'Normal governed development must use the declared canonical worktree; Git topology is not an isolation mechanism.'
      );
    }
    if (input.operation === 'apply-shared-delivery' && input.actorRole !== 'neutral-steward') {
      return rejected(
        'rejected-direct-worker-write',
        'Only the neutral steward may apply a composed shared delivery to the canonical worktree.'
      );
    }
    return {
      allowed: true,
      verdict: 'canonical-development',
      reason: 'Canonical worktree admission accepted; logical intent remains the compose-or-queue decision boundary.'
    };
  }

  // Runtime callers are still untrusted even though TypeScript exposes a
  // closed purpose union. Unknown exception labels must never become waivers.
  if (!exceptionPurposes.has(input.purpose)) {
    return rejected(
      'rejected-unsupported-purpose',
      'The requested workspace-topology purpose is not a closed, supported exception.'
    );
  }
  if (!input.exceptionReceiptId?.trim()) {
    return rejected(
      'rejected-missing-exception-receipt',
      'A non-development topology exception requires a named receipt.'
    );
  }
  if (input.operation === 'apply-shared-delivery') {
    return rejected(
      'rejected-direct-worker-write',
      'Topology exceptions cannot apply normal governed shared-delivery writes.'
    );
  }
  return {
    allowed: true,
    verdict: 'documented-exception',
    reason: `Documented ${input.purpose} exception accepted with receipt ${input.exceptionReceiptId}.`
  };
}

function rejected(verdict: Exclude<WorkspaceTopologyVerdict, 'canonical-development' | 'documented-exception'>, reason: string): WorkspaceTopologyPolicyDecision {
  return { allowed: false, verdict, reason };
}

function normalizeRoot(root: string): string {
  const normalized = root.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/');
  // Drive-letter and UNC roots use Windows case-insensitive identity. POSIX
  // roots remain case-sensitive so /repo and /Repo cannot be falsely merged.
  return /^(?:[a-z]:\/|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized;
}
