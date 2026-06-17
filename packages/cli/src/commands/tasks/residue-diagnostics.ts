import {
  assessCloseoutProvenanceGap,
  verifyCloseoutProvenance
} from './closeout-provenance.ts';

export type TaskResidueBucket =
  | 'no-residue'
  | 'complete-but-unfinalized'
  | 'closeback-finalize'
  | 'source-done-governance-incomplete'
  | 'planning-mirror-only'
  | 'interrupted-close'
  | 'stale-import'
  | 'ambiguous-manual-review';

export interface TaskResidueClassification {
  bucket: TaskResidueBucket;
  truth: string;
  residue: string;
  reason: string;
  nextCommandTemplate: string;
  nextCommand: string;
  autoMutationAllowed: false;
}

export interface TaskResidueLedgerSnapshot {
  status: string | null;
  claimState: string | null;
  lastTransitionId: string | null;
  lastTransitionAt: string | null;
}

export interface TaskResiduePlanningSnapshot {
  status: string | null;
  source: string | null;
}

export interface TaskResidueTransitionSnapshot {
  action: string | null;
  actorId: string | null;
  createdAt: string | null;
  fromStatus: string | null;
  toStatus: string | null;
}

export interface TaskResidueDivergence {
  field: string;
  liveLedger: string | null;
  planningFrontmatter?: string | null;
  lastTransitionEvent?: string | null;
}

/** 單筆 scope-amendment 事件的可讀快照（供 status 與 closeback 輸出使用）。 */
export interface TaskScopeAmendmentSnapshot {
  transitionId: string;
  actorId: string | null;
  createdAt: string;
  addedPaths: string[];
  amendmentClass: string | null;
  amendmentPhase: string | null;
  amendmentMode: 'normal' | 'repair' | null;
  reason: string | null;
}

export interface TaskStatusTriangulation {
  ssot: 'liveLedger';
  liveLedger: TaskResidueLedgerSnapshot;
  lastTransitionEvent: TaskResidueTransitionSnapshot | null;
  planningFrontmatter: TaskResiduePlanningSnapshot;
  divergence: TaskResidueDivergence[];
  recommendation: string | null;
  residueClassification: TaskResidueClassification;
  /** 所有已記錄的範圍增修歷史（按時間順序排列）。 */
  amendmentHistory: TaskScopeAmendmentSnapshot[];
}

export interface TaskResidueDiagnosisEvidence {
  readonly schemaId: 'atm.taskResidueDiagnosis.v1';
  readonly taskId: string;
  readonly bucket: TaskResidueBucket;
  readonly truth: string;
  readonly residue: string;
  readonly reason: string;
  readonly nextCommand: string;
  readonly nextCommandTemplate: string;
  readonly autoMutationAllowed: false;
  readonly diagnostics: {
    readonly codes: readonly string[];
    readonly messages: readonly string[];
  };
  readonly triangulation: TaskStatusTriangulation;
}

export function buildResidueClassification(input: {
  cwd: string;
  taskId: string;
  taskDocument: Record<string, unknown>;
  liveLedger: TaskResidueLedgerSnapshot;
  planningFrontmatter: TaskResiduePlanningSnapshot;
  lastTransitionEvent: TaskResidueTransitionSnapshot | null;
  divergence: readonly TaskResidueDivergence[];
}): TaskResidueClassification {
  const base = classifyTaskResidue(input);
  return {
    ...base,
    nextCommandTemplate: base.nextCommand,
    nextCommand: materializeResidueNextCommand(base.nextCommand, input.taskId, input.planningFrontmatter.source),
    autoMutationAllowed: false
  };
}

export function buildResidueDiagnosisEvidenceFromTriangulation(input: {
  readonly taskId: string;
  readonly triangulation: TaskStatusTriangulation;
}): TaskResidueDiagnosisEvidence {
  const residue = input.triangulation.residueClassification;
  return {
    schemaId: 'atm.taskResidueDiagnosis.v1',
    taskId: input.taskId,
    bucket: residue.bucket,
    truth: residue.truth,
    residue: residue.residue,
    reason: residue.reason,
    nextCommand: residue.nextCommand,
    nextCommandTemplate: residue.nextCommandTemplate,
    autoMutationAllowed: residue.autoMutationAllowed,
    diagnostics: {
      codes: [`ATM_TASK_RESIDUE_${residue.bucket.toUpperCase().replace(/-/g, '_')}`],
      messages: [residue.reason, `Recommended next command: ${residue.nextCommand}`]
    },
    triangulation: input.triangulation
  };
}

function materializeResidueNextCommand(template: string, taskId: string, planningCardPath: string | null): string {
  const planPath = planningCardPath ?? '<plan.md>';
  return template
    .replaceAll('<id>', taskId)
    .replaceAll('<plan.md>', planPath);
}

function classifyTaskResidue(input: {
  cwd: string;
  taskId: string;
  taskDocument: Record<string, unknown>;
  liveLedger: TaskResidueLedgerSnapshot;
  planningFrontmatter: TaskResiduePlanningSnapshot;
  lastTransitionEvent: TaskResidueTransitionSnapshot | null;
  divergence: readonly TaskResidueDivergence[];
}): Omit<TaskResidueClassification, 'nextCommandTemplate' | 'autoMutationAllowed'> & { nextCommand: string } {
  const closurePacket = normalizeOptionalString(input.taskDocument.closurePacket ?? input.taskDocument.closure_packet);
  const closedAt = normalizeOptionalString(input.taskDocument.closedAt ?? input.taskDocument.closed_at);
  const hasHistoricalCloseArtifacts = Boolean(closurePacket || closedAt || input.lastTransitionEvent?.action === 'close');
  const planningDone = input.planningFrontmatter.status === 'done';
  const liveDone = input.liveLedger.status === 'done';
  const activeClaim = input.liveLedger.claimState === 'active';
  const mirrorPath = normalizeOptionalString(input.planningFrontmatter.source);
  const planningMirrorOnly = Boolean(
    planningDone
    && liveDone
    && (normalizeOptionalString(input.taskDocument.planningRepo ?? input.taskDocument.planning_repo) === normalizeOptionalString(input.taskDocument.targetRepo ?? input.taskDocument.target_repo))
  );

  if (planningDone && !liveDone) {
    if (hasHistoricalCloseArtifacts) {
      if (closurePacket && activeClaim) {
        return {
          bucket: 'complete-but-unfinalized',
          truth: 'closure artifacts exist while the live ledger has not finalized done',
          residue: 'The task has close artifacts but still carries an active operator claim and an unfinished live ledger status.',
          nextCommand: 'node atm.mjs tasks reconcile --task <id> --json',
          reason: 'A close transition appears to have been prepared without finalizing ledger state, so reconcile must inspect the delivery before mutating state.'
        };
      }
      return {
        bucket: 'closeback-finalize',
        truth: 'closure packet exists but ledger is not done',
        residue: 'The closure packet is prepared but the live ledger has not recorded the done status.',
        nextCommand: 'node atm.mjs taskflow close --task <id> --json',
        reason: 'Closure packet exists, so the task should be finalized via taskflow close.'
      };
    }
    return {
      bucket: 'closeback-finalize',
      truth: 'planning record says done but target ledger is not done',
      residue: 'Planning record is done, but the live ledger is not done.',
      nextCommand: 'node atm.mjs taskflow close --task <id> --json',
      reason: 'Planning record says done, so the task should be finalized via taskflow close.'
    };
  }

  if (liveDone && !planningDone && verifyCloseoutProvenance(input.cwd, input.taskId, input.taskDocument)) {
    const isCrossRepo = normalizeOptionalString(input.taskDocument.planningRepo ?? input.taskDocument.planning_repo)
      !== normalizeOptionalString(input.taskDocument.targetRepo ?? input.taskDocument.target_repo);
    return {
      bucket: (mirrorPath && !isCrossRepo) ? 'planning-mirror-only' : 'stale-import',
      truth: 'live ledger is done, but the planning mirror has not converged',
      residue: (mirrorPath && !isCrossRepo) ? 'Only the planning mirror remains to be refreshed or retired.' : 'The imported ledger is ahead of the planning mirror.',
      nextCommand: 'node atm.mjs tasks import --from <plan.md> --write --force --json',
      reason: (mirrorPath && !isCrossRepo) ? 'The task appears complete in the target ledger, but the planning mirror still needs a governed refresh.' : 'The ledger is ahead of the planning mirror and should be re-imported from the authoritative plan.'
    };
  }

  if (planningDone && liveDone && activeClaim) {
    return {
      bucket: 'interrupted-close',
      truth: 'both mirrors say done, but the live claim state is still active',
      residue: 'The close was interrupted before the claim fully released.',
      nextCommand: 'node atm.mjs tasks repair-closure --task <id> --json',
      reason: 'A done/done task still carries an active claim, so the finalization flow needs repair rather than a new close.'
    };
  }

  if (
    planningDone
    && liveDone
    && input.divergence.length === 0
    && !planningMirrorOnly
    && verifyCloseoutProvenance(input.cwd, input.taskId, input.taskDocument)
  ) {
    return {
      bucket: 'no-residue',
      truth: 'planning mirror and live ledger agree on governed done',
      residue: 'No closeback residue remains for this task.',
      nextCommand: 'node atm.mjs tasks status --task <id> --json',
      reason: 'The live ledger is done, the planning mirror is done, closeout provenance is complete, and no status divergence remains.'
    };
  }

  if (liveDone && !verifyCloseoutProvenance(input.cwd, input.taskId, input.taskDocument)) {
    const gap = assessCloseoutProvenanceGap(input.cwd, input.taskId, input.taskDocument);
    if (gap.bucket === 'source-done-governance-incomplete') {
      return {
        bucket: 'source-done-governance-incomplete',
        truth: gap.truth,
        residue: `${gap.residue} Missing proof segments: ${gap.missingSegments.join(', ')}.`,
        nextCommand: gap.recoveryCommand,
        reason: gap.reason
      };
    }
  }

  if (planningMirrorOnly) {
    return {
      bucket: 'planning-mirror-only',
      truth: 'planning mirror and live ledger align as done, but the task is still within a planning-mirror authority shape',
      residue: 'The residue lives in the planning mirror rather than the live ledger.',
      nextCommand: 'node atm.mjs tasks import --from <plan.md> --write --json',
      reason: 'This task is planning-mirror-owned, so the operator should refresh the mirrored source of truth instead of forcing close.'
    };
  }

  if (input.divergence.length > 0) {
    return {
      bucket: 'ambiguous-manual-review',
      truth: 'the status surfaces disagree, but the operator path is not unique',
      residue: 'There are multiple possible governed next steps and the system should fail closed.',
      nextCommand: 'node atm.mjs tasks status --task <id> --json',
      reason: 'The divergence pattern is not enough to choose a single governed operator action.'
    };
  }

  return {
    bucket: 'ambiguous-manual-review',
    truth: 'no residue bucket is clearly dominant',
    residue: 'The state is too quiet to classify as a governed residue bucket without more evidence.',
    nextCommand: 'node atm.mjs tasks status --task <id> --json',
    reason: 'The current status triangulation does not expose a decisive residue path.'
  };
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
