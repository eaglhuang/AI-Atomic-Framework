import type { TaskResidueBucket } from './residue-diagnostics.ts';

export type TaskflowCloseMode =
  | 'normal-close'
  | 'historical-delivery-close'
  | 'planning-mirror-sync-repair'
  | 'residue-repair'
  | 'ambiguous-manual-review';

export type TaskflowCloseBackend =
  | 'tasks-close'
  | 'tasks-reconcile'
  | 'tasks-import'
  | 'tasks-repair-closure'
  | 'tasks-status';

export const taskflowCloseEvidenceValidators: readonly string[] = [
  'npm run typecheck',
  'npm run validate:cli',
  'node --strip-types scripts/validate-task-ledger-governance.ts --mode validate'
] as const;

export const taskflowCloseGovernanceEvidenceValidator =
  'node --strip-types scripts/validate-governance-commands.ts --mode validate';

export function resolveTaskflowCloseBackend(
  bucket: TaskResidueBucket,
  closeMode: TaskflowCloseMode
): TaskflowCloseBackend {
  if (closeMode === 'ambiguous-manual-review') {
    return 'tasks-status';
  }
  if (closeMode === 'residue-repair' || bucket === 'interrupted-close') {
    return 'tasks-repair-closure';
  }
  if (closeMode === 'planning-mirror-sync-repair') {
    return 'tasks-import';
  }
  if (bucket === 'complete-but-unfinalized') {
    return 'tasks-reconcile';
  }
  return 'tasks-close';
}

export function resolveTaskflowCloseMode(input: {
  bucket: TaskResidueBucket;
  liveStatus: string | null;
  planningStatus?: string | null;
  historicalDeliveryRefs: string[];
  planningAuthorityDeliveryOk?: boolean;
  divergenceCount: number;
}): TaskflowCloseMode {
  const liveStatus = normalizeLifecycleStatus(input.liveStatus);
  const planningStatus = normalizeLifecycleStatus(input.planningStatus ?? null);
  const activeLiveLedger = isActiveLedgerStatus(liveStatus);
  const openPlanningMirror = isOpenPlanningStatus(planningStatus);
  if (input.bucket === 'ambiguous-manual-review') {
    if (input.planningAuthorityDeliveryOk && input.historicalDeliveryRefs.length > 0) {
      return 'historical-delivery-close';
    }
    if (activeLiveLedger && openPlanningMirror) {
      return 'normal-close';
    }
    if (
      input.divergenceCount === 0
      && liveStatus
      && !['done', 'blocked', 'abandoned'].includes(liveStatus)
    ) {
      return 'normal-close';
    }
    return 'ambiguous-manual-review';
  }
  if (input.bucket === 'planning-mirror-only' || input.bucket === 'stale-import') {
    return 'planning-mirror-sync-repair';
  }
  if (input.bucket === 'interrupted-close') {
    return 'residue-repair';
  }
  if (input.bucket === 'complete-but-unfinalized' || input.bucket === 'source-done-governance-incomplete') {
    return 'historical-delivery-close';
  }
  if (liveStatus === 'done') {
    return 'ambiguous-manual-review';
  }
  if (activeLiveLedger && openPlanningMirror) {
    return 'normal-close';
  }
  if (input.historicalDeliveryRefs.length > 0) {
    return 'historical-delivery-close';
  }
  if (input.divergenceCount === 0) {
    return 'normal-close';
  }
  return 'ambiguous-manual-review';
}

function normalizeLifecycleStatus(status: string | null): string | null {
  const normalized = String(status ?? '').trim().toLowerCase().replace(/-/g, '_');
  return normalized || null;
}

function isActiveLedgerStatus(status: string | null): boolean {
  return !!status && !['done', 'blocked', 'abandoned'].includes(status);
}

function isOpenPlanningStatus(status: string | null): boolean {
  if (!status) return true;
  return ['planned', 'open', 'ready', 'running', 'in_progress', 'review'].includes(status);
}
