import type { RouteClaimIntent, RouteContext } from '../../../../core/src/routing/index.ts';

export type RouteLifecycleAction = 'open' | 'status' | 'list' | 'pause' | 'resume' | 'abandon' | 'handoff';
export type RouteAction = RouteLifecycleAction | 'takeover';

export const lifecycleActions = new Set<RouteLifecycleAction>(['open', 'status', 'list', 'pause', 'resume', 'abandon', 'handoff']);
export const routeFileNamePattern = /^route-[A-Za-z0-9._:-]+\.json$/;

export interface RouteOptions {
  readonly cwd: string;
  readonly action: RouteAction;
  readonly routeId: string | null;
  readonly taskId: string | null;
  readonly actorId: string | null;
  readonly claimIntent: RouteClaimIntent;
  readonly leaseId: string | null;
  readonly ttlSeconds: number;
  readonly maxSeconds: number;
  readonly readSet: string[];
  readonly writeSet: string[];
  readonly targetAtomCids: string[];
  readonly targetVirtualAtomCids: string[];
  readonly patchEnvelopeRef: string | null;
  readonly reason: string | null;
  readonly admissionRechecked: boolean;
  readonly mergePlanFile: string | null;
  readonly proposalFile: string | null;
  readonly stewardId: string | null;
  readonly evidenceOutPath: string | null;
  readonly scopeFiles: string[];
}

export type RouteContextValidation = { readonly ok: true; readonly value: RouteContext } | { readonly ok: false; readonly errors: readonly string[] };
