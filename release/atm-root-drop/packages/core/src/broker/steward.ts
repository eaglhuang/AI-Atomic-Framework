import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildStewardApplyEvidence, type StewardApplyEvidence } from './apply-evidence.ts';
import { sortProposalsForCompose } from './merge-plan.ts';
import { validateStewardInputs } from './steward-input-validation.ts';
import { formatStewardCompositionBlock } from './steward-base-composer.ts';
import {
  applyTransactionalStewardPlan,
  buildPatchProposalComposition,
  buildStewardSemanticValidationReceipt,
  type TransactionalStewardApplyResult
} from './steward-transactional-apply.ts';
import { waitStewardRecomposeBackoff } from './steward-commit-guard.ts';
import { resolveStewardCommitControls, withStewardApplyQueue } from './steward-apply-queue.ts';
import type { VirtualAtomInUseRegistryDocument } from './registry.ts';
import type { TeamBrokerRuntimeActivationHandshakeEvidence } from './team-lane.ts';
import type {
  BrokerOperationRunRecordEnvelope,
  DecompositionRequest,
  MergePlan,
  MergeVerdict,
  PatchProposal
} from './types.ts';
export { applyUnifiedPatch } from './unified-patch.ts';
// Steward arbitration verdict ??the four possible outcomes per implementation
// contract (TASK-MAO-0009).
export type StewardArbitrationVerdict =
  | 'apply'
  | 'merge-required'
  | 'blocked'
  | 'human-required';
export type StewardValidationCode =
  | 'scope-lock-mismatch'
  | 'stale-base-commit'
  | 'file-hash-drift'
  | 'invalid-merge-plan'
  | 'out-of-scope-target'
  | 'blocked-merge-plan'
  | 'missing-proposal'
  | 'invalid-steward-identity'
  | 'human-review-required'
  | 'compose-context-mismatch'
  | 'steward-final-patch-required'
  | 'compose-permutation-unstable';
export interface StewardValidationIssue {
  readonly code: StewardValidationCode;
  readonly detail: string;
}
export interface StewardPlanStep {
  readonly proposalId: string;
  readonly targetFile: string;
  readonly applyMethod: MergePlan['applyMethod'];
}
export interface StewardPlan {
  readonly schemaId: 'atm.stewardPlan.v1';
  readonly specVersion: '0.1.0';
  readonly stewardId: string;
  readonly mergePlanId: string;
  readonly ok: boolean;
  readonly steps: readonly StewardPlanStep[];
  readonly targetFiles: readonly string[];
  readonly issues: readonly StewardValidationIssue[];
}
export interface StewardPlanResult {
  readonly ok: boolean;
  readonly plan: StewardPlan;
}
export interface StewardApplyResult {
  readonly ok: boolean;
  readonly evidence: StewardApplyEvidence;
}
// Steward identity & permission check.
export interface StewardIdentity {
  /** The steward's identifier (e.g. 'neutral-write-steward', 'runner-broker'). */
  readonly stewardId: string;
  /** The type of steward. 'neutral' is the default; 'derived-artifact-writer'
   *  is a specialized path for ATM core Runner Broker scoped writes. */
  readonly kind: 'neutral' | 'derived-artifact-writer';
  /** The route or task that authorised this steward session. */
  readonly authorisedByRouteId?: string;
  readonly authorisedByTaskId?: string;
}
export interface StewardPermissionCheckResult {
  readonly ok: boolean;
  readonly stewardId: string;
  readonly kind: StewardIdentity['kind'];
  readonly issues: readonly StewardValidationIssue[];
}
/**
 * Validates that a steward identity is well-formed and authorised.
 * Derived-artifact writers must declare a route or task authorisation.
 */
export function checkStewardPermission(identity: StewardIdentity): StewardPermissionCheckResult {
  const issues: StewardValidationIssue[] = [];
  if (!identity.stewardId || identity.stewardId.trim().length === 0) {
    issues.push({ code: 'invalid-steward-identity', detail: 'stewardId must be a non-empty string.' });
  }
  if (identity.kind === 'derived-artifact-writer') {
    if (!identity.authorisedByRouteId && !identity.authorisedByTaskId) {
      issues.push({
        code: 'invalid-steward-identity',
        detail: 'Derived-artifact writer steward must declare authorisedByRouteId or authorisedByTaskId.'
      });
    }
  }
  return { ok: issues.length === 0, stewardId: identity.stewardId, kind: identity.kind, issues };
}
// ---------------------------------------------------------------------------
// Steward arbitration result ??the top-level output of arbitrateStewardRequest.
// ---------------------------------------------------------------------------
export interface StewardArbitrationResult {
  readonly schemaId: 'atm.stewardArbitrationResult.v1';
  readonly specVersion: '0.1.0';
  readonly stewardId: string;
  readonly verdict: StewardArbitrationVerdict;
  readonly owningRouteId: string | null;
  readonly owningTaskId: string | null;
  readonly plan: StewardPlan | null;
  readonly applyEvidence: StewardApplyEvidence | null;
  readonly issues: readonly StewardValidationIssue[];
}
export interface BrokerScopedWriteExecutionEvidence {
  readonly schemaId: 'atm.brokerScopedWriteExecution.v1';
  readonly specVersion: '0.1.0';
  readonly stewardId: string;
  readonly mergePlanId: string;
  readonly allowedFiles: readonly string[];
  readonly handshake: TeamBrokerRuntimeActivationHandshakeEvidence;
  readonly decompositionRequest: DecompositionRequest | null;
  readonly virtualAtomInUseRegistry: VirtualAtomInUseRegistryDocument;
  readonly applyEvidence: StewardApplyEvidence | null;
  readonly verdict: 'applied' | 'blocked';
  readonly blockedReasons: readonly string[];
}
export interface BrokerScopedWriteExecutionResult {
  readonly ok: boolean;
  readonly evidence: BrokerScopedWriteExecutionEvidence;
}
export function planStewardApply(input: {
  readonly cwd: string;
  readonly stewardId: string;
  readonly mergePlan: MergePlan;
  readonly proposals: readonly PatchProposal[];
  readonly scopeFiles: readonly string[];
}): StewardPlanResult {
  const issues = validateStewardInputs(input);
  const sorted = sortProposalsForCompose(input.proposals);
  const steps = issues.length === 0
    ? sorted.map((proposal) => ({
        proposalId: proposal.proposalId,
        targetFile: proposal.targetFile,
        applyMethod: input.mergePlan.applyMethod
      }))
    : [];
  const plan: StewardPlan = {
    schemaId: 'atm.stewardPlan.v1',
    specVersion: '0.1.0',
    stewardId: input.stewardId,
    mergePlanId: input.mergePlan.mergePlanId,
    ok: issues.length === 0,
    steps,
    targetFiles: [...new Set(sorted.map((proposal) => proposal.targetFile))].sort((left, right) => left.localeCompare(right)),
    issues
  };
  return { ok: plan.ok, plan };
}
export interface StewardRecomposePolicy {
  readonly maxRecomposeAttempts?: number;
  readonly recomposeBackoffMs?: number;
  readonly recomposeJitterMs?: number;
}

export function applyStewardPlan(input: {
  readonly cwd: string;
  readonly stewardId: string;
  readonly mergePlan: MergePlan;
  readonly proposals: readonly PatchProposal[];
  readonly scopeFiles: readonly string[];
  readonly evidenceOutPath?: string | null;
  /** Argument, then `ATM_STEWARD_RECOMPOSE_POLICY`, then `stewardCanonicalCommitPolicy`. Not a CLI flag. */
  readonly recomposePolicy?: StewardRecomposePolicy;
  /** Argument, then `ATM_STEWARD_COMMIT_LOCK_ROOT`. Not a CLI flag. */
  readonly commitLockRoot?: string;
  /** Argument, then `ATM_STEWARD_APPLY_QUEUE`. Not a CLI flag. The file lock stays the correctness backstop. */
  readonly applyQueue?: boolean;
  /** Argument, then `ATM_STEWARD_APPLY_QUEUE_ROOT`. Not a CLI flag. */
  readonly applyQueueRoot?: string;
  /** Argument, then `ATM_STEWARD_APPLY_QUEUE_WAIT_MS`. Not a CLI flag. */
  readonly applyQueueWaitMs?: number;
  /** Forwarded to the transactional apply. Not a CLI flag. */
  readonly commitHooks?: {
    readonly beforePrecheck?: () => void;
    readonly afterPrecheck?: () => void;
  };
}): StewardApplyResult {
  const planResult = planStewardApply(input);
  const controls = resolveStewardCommitControls(input);
  const attemptBudget = controls.maxRecomposeAttempts + 1;
  const outcome = planResult.ok
    ? withStewardApplyQueue({
      cwd: input.cwd,
      targetPaths: planResult.plan.targetFiles.map((file) => path.resolve(input.cwd, file)),
      enabled: controls.applyQueue,
      queueRoot: controls.applyQueueRoot,
      waitMs: controls.applyQueueWaitMs,
      pollMs: controls.lockPollMs
    }, () => {
      let transactional = buildPatchProposalComposition({ cwd: input.cwd, mergePlan: input.mergePlan, proposals: input.proposals });
      let apply: TransactionalStewardApplyResult | null = null;
      let attemptsUsed = 0;
      if (!transactional.blocked) {
        const baseHead = readGitHeadCommit(input.cwd);
        for (let attempt = 0; attempt < attemptBudget; attempt += 1) {
          attemptsUsed = attempt + 1;
          if (attempt > 0) {
            waitStewardRecomposeBackoff(attempt, controls.recomposeBackoffMs, controls.recomposeJitterMs);
            transactional = buildPatchProposalComposition({ cwd: input.cwd, mergePlan: input.mergePlan, proposals: input.proposals });
            if (transactional.blocked) break;
          }
          const semanticValidation = buildStewardSemanticValidationReceipt({
            plan: transactional.plan,
            outputFiles: transactional.outputFiles
          });
          apply = applyTransactionalStewardPlan({
            cwd: input.cwd,
            stewardId: input.stewardId,
            writerRole: 'neutral-steward',
            plan: transactional.plan,
            outputFiles: transactional.outputFiles,
            scopeFiles: input.scopeFiles,
            semanticValidation,
            baseHead,
            commitLockRoot: controls.lockRoot,
            commitHooks: input.commitHooks
          });
          if (apply.ok || apply.receipt.verdict !== 're-compose') break;
        }
      }
      return { transactional, apply, attemptsUsed };
    })
    : null;
  const transactional = outcome?.transactional ?? null;
  const apply = outcome?.apply ?? null;
  const attemptsUsed = outcome?.attemptsUsed ?? 0;
  if (!planResult.ok || transactional?.blocked) {
    const brokerOperationRun = buildStewardBrokerOperationRun({
      mergePlan: input.mergePlan,
      proposals: input.proposals,
      appliedFiles: [],
      evidencePath: input.evidenceOutPath ?? null
    });
    const evidence = buildStewardApplyEvidence({
      stewardId: input.stewardId,
      mergePlan: input.mergePlan,
      proposalIds: input.mergePlan.inputProposals,
      targetFiles: planResult.plan.targetFiles,
      appliedFiles: [],
      fileBeforeHashes: {},
      fileAfterHashes: {},
      verdict: 'blocked',
      blockedReasons: transactional?.blocked
        ? [formatStewardCompositionBlock(transactional.blocked), ...input.mergePlan.conflicts.map((conflict) => `conflict: ${conflict.detail}`)]
        : planResult.plan.issues.map((issue) => `${issue.code}: ${issue.detail}`),
      brokerOperationRun
    });
    if (input.evidenceOutPath) writeEvidenceFile(input.evidenceOutPath, evidence);
    return { ok: false, evidence };
  }
  if (!transactional || !apply) throw new Error('steward composition missing after a successful plan');
  const fileBeforeHashes = Object.fromEntries(apply.receipt.files.map((file) => [file.filePath, stripShaPrefix(file.beforeHash)]));
  const fileAfterHashes = Object.fromEntries(apply.receipt.files.map((file) => [file.filePath, stripShaPrefix(file.afterHash)]));
  const appliedFiles = apply.ok ? apply.receipt.files.map((file) => file.filePath).sort((left, right) => left.localeCompare(right)) : [];
  appliedFiles.sort((left, right) => left.localeCompare(right));
  const brokerOperationRun = buildStewardBrokerOperationRun({
    mergePlan: input.mergePlan,
    proposals: input.proposals,
    appliedFiles,
    evidencePath: input.evidenceOutPath ?? null
  });
  const evidence = buildStewardApplyEvidence({
    stewardId: input.stewardId,
    mergePlan: input.mergePlan,
    proposalIds: input.mergePlan.inputProposals,
    targetFiles: planResult.plan.targetFiles,
    appliedFiles,
    fileBeforeHashes,
    fileAfterHashes,
    verdict: apply.ok ? 'applied' : 'blocked',
    blockedReasons: apply.ok ? undefined : recomposeTerminalReasons(apply, attemptsUsed, attemptBudget),
    brokerOperationRun
  });
  if (input.evidenceOutPath) writeEvidenceFile(input.evidenceOutPath, evidence);
  return { ok: apply.ok, evidence };
}
export function executeBrokerScopedWrite(input: {
  readonly cwd: string;
  readonly stewardId: string;
  readonly mergePlan: MergePlan;
  readonly proposals: readonly PatchProposal[];
  readonly scopeFiles: readonly string[];
  readonly handshake: TeamBrokerRuntimeActivationHandshakeEvidence;
  readonly evidenceOutPath?: string | null;
}): BrokerScopedWriteExecutionResult {
  const allowedFiles = [...new Set(input.handshake.scopedWriteExecution.allowedFiles.map((entry) => entry.replace(/\\/g, '/')).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const scopeFiles = [...new Set(input.scopeFiles.map((entry) => entry.replace(/\\/g, '/')).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const decompositionRequest = input.handshake.brokerLane.decision.decompositionRequest ?? null;
  if (!input.handshake.scopedWriteExecution.approved) {
    return {
      ok: false,
      evidence: {
        schemaId: 'atm.brokerScopedWriteExecution.v1',
        specVersion: '0.1.0',
        stewardId: input.stewardId,
        mergePlanId: input.mergePlan.mergePlanId,
        allowedFiles,
        handshake: input.handshake,
        decompositionRequest,
        virtualAtomInUseRegistry: input.handshake.brokerLane.virtualAtomInUseRegistry,
        applyEvidence: null,
        verdict: 'blocked',
        blockedReasons: input.handshake.blockedReasons.length > 0
          ? input.handshake.blockedReasons
          : ['Broker runtime activation handshake is not approved.']
      }
    };
  }
  if (allowedFiles.length !== scopeFiles.length || allowedFiles.some((entry, index) => entry !== scopeFiles[index])) {
    return {
      ok: false,
      evidence: {
        schemaId: 'atm.brokerScopedWriteExecution.v1',
        specVersion: '0.1.0',
        stewardId: input.stewardId,
        mergePlanId: input.mergePlan.mergePlanId,
        allowedFiles,
        handshake: input.handshake,
        decompositionRequest,
        virtualAtomInUseRegistry: input.handshake.brokerLane.virtualAtomInUseRegistry,
        applyEvidence: null,
        verdict: 'blocked',
        blockedReasons: ['Scoped write request does not match broker-approved allowed files.']
      }
    };
  }
  const applyResult = applyStewardPlan({
    cwd: input.cwd,
    stewardId: input.stewardId,
    mergePlan: input.mergePlan,
    proposals: input.proposals,
    scopeFiles,
    evidenceOutPath: input.evidenceOutPath
  });
  return {
    ok: applyResult.ok,
    evidence: {
      schemaId: 'atm.brokerScopedWriteExecution.v1',
      specVersion: '0.1.0',
      stewardId: input.stewardId,
      mergePlanId: input.mergePlan.mergePlanId,
      allowedFiles,
      handshake: input.handshake,
      decompositionRequest,
      virtualAtomInUseRegistry: input.handshake.brokerLane.virtualAtomInUseRegistry,
      applyEvidence: applyResult.evidence,
      verdict: applyResult.ok ? 'applied' : 'blocked',
      blockedReasons: applyResult.ok ? [] : (applyResult.evidence.blockedReasons ?? ['Broker scoped write apply was blocked.'])
    }
  };
}
// Top-level steward arbitration entry point (TASK-MAO-0009).
// Wraps planning, identity checks, and verdict production. Records
// route/task/evidence links as required by the acceptance criteria.
export function arbitrateStewardRequest(input: {
  readonly cwd: string;
  readonly identity: StewardIdentity;
  readonly mergePlan: MergePlan;
  readonly proposals: readonly PatchProposal[];
  readonly scopeFiles: readonly string[];
  readonly owningRouteId?: string | null;
  readonly owningTaskId?: string | null;
  readonly evidenceOutPath?: string | null;
}): StewardArbitrationResult {
  const owningRouteId = input.owningRouteId ?? input.identity.authorisedByRouteId ?? null;
  const owningTaskId = input.owningTaskId ?? input.identity.authorisedByTaskId ?? null;
  // 1. Identity / permission gate
  const permResult = checkStewardPermission(input.identity);
  if (!permResult.ok) {
    return {
      schemaId: 'atm.stewardArbitrationResult.v1',
      specVersion: '0.1.0',
      stewardId: input.identity.stewardId,
      verdict: 'blocked',
      owningRouteId,
      owningTaskId,
      plan: null,
      applyEvidence: null,
      issues: permResult.issues
    };
  }
  // 2. Human-required verdict: fail closed, steward cannot auto-resolve
  if (input.mergePlan.verdict === 'human-required') {
    return {
      schemaId: 'atm.stewardArbitrationResult.v1',
      specVersion: '0.1.0',
      stewardId: input.identity.stewardId,
      verdict: 'human-required',
      owningRouteId,
      owningTaskId,
      plan: null,
      applyEvidence: null,
      issues: [{ code: 'human-review-required', detail: 'Merge plan verdict is human-required; steward cannot auto-resolve.' }]
    };
  }
  // 3. Plan the apply
  const planResult = planStewardApply({
    cwd: input.cwd,
    stewardId: input.identity.stewardId,
    mergePlan: input.mergePlan,
    proposals: input.proposals,
    scopeFiles: input.scopeFiles
  });
  if (!planResult.ok) {
    // Determine if this is a merge-required or hard-blocked situation
    const hasBlockingConflict = planResult.plan.issues.some(
      (issue) => issue.code === 'blocked-merge-plan' || issue.code === 'out-of-scope-target' || issue.code === 'invalid-steward-identity'
    );
    const verdict: StewardArbitrationVerdict = hasBlockingConflict ? 'blocked' : 'merge-required';
    return {
      schemaId: 'atm.stewardArbitrationResult.v1',
      specVersion: '0.1.0',
      stewardId: input.identity.stewardId,
      verdict,
      owningRouteId,
      owningTaskId,
      plan: planResult.plan,
      applyEvidence: null,
      issues: planResult.plan.issues
    };
  }
  // 4. Apply the plan
  const applyResult = applyStewardPlan({
    cwd: input.cwd,
    stewardId: input.identity.stewardId,
    mergePlan: input.mergePlan,
    proposals: input.proposals,
    scopeFiles: input.scopeFiles,
    evidenceOutPath: input.evidenceOutPath
  });
  return {
    schemaId: 'atm.stewardArbitrationResult.v1',
    specVersion: '0.1.0',
    stewardId: input.identity.stewardId,
    verdict: applyResult.ok ? 'apply' : 'blocked',
    owningRouteId,
    owningTaskId,
    plan: planResult.plan,
    applyEvidence: applyResult.evidence,
    issues: applyResult.ok ? [] : (applyResult.evidence.blockedReasons ?? []).map((reason) => ({ code: 'blocked-merge-plan' as StewardValidationCode, detail: reason }))
  };
}
function writeEvidenceFile(filePath: string, evidence: StewardApplyEvidence): void {
  mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}
function buildStewardBrokerOperationRun(input: {
  readonly mergePlan: MergePlan;
  readonly proposals: readonly PatchProposal[];
  readonly appliedFiles: readonly string[];
  readonly evidencePath: string | null;
}): BrokerOperationRunRecordEnvelope {
  const sortedProposals = sortProposalsForCompose(input.proposals);
  const proposalIds = [...new Set(sortedProposals.map((proposal) => proposal.proposalId).concat(input.mergePlan.inputProposals))]
    .sort((left, right) => left.localeCompare(right));
  const actorIds = [...new Set(sortedProposals.map((proposal) => proposal.actorId).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const requestFiles = [...new Set(sortedProposals.map((proposal) => proposal.targetFile).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const taskIds = [...new Set(sortedProposals.map((proposal) => proposal.taskId).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const commitShas = [...new Set(sortedProposals.map((proposal) => proposal.baseCommit).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const transactionIds = [...new Set(sortedProposals.flatMap((proposal) => extractProposalTransactionIds(proposal)))]
    .sort((left, right) => left.localeCompare(right));
  const appliedFiles = [...new Set(input.appliedFiles)].sort((left, right) => left.localeCompare(right));
  const mergeVerdict = mapStewardMergeVerdict(input.mergePlan.verdict);
  const record = {
    schemaId: 'atm.brokerOperationRunRecord.v1' as const,
    specVersion: '0.1.0' as const,
    migration: input.mergePlan.migration,
    runId: `steward-${input.mergePlan.mergePlanId}`,
    planId: input.mergePlan.mergePlanId,
    request_identity: proposalIds,
    actor_ids: actorIds,
    request_files: requestFiles,
    adapter_choice: `steward.${input.mergePlan.applyMethod}`,
    applied_files: appliedFiles,
    lane_decision: 'neutral-steward',
    merge_verdict: mergeVerdict,
    evidence_path: input.evidencePath ?? 'inline:steward-apply-evidence',
    ...(taskIds.length > 0 ? { task_ids: taskIds } : {}),
    ...(commitShas.length === 1 ? { commit_sha: commitShas[0] } : {}),
    ...(transactionIds.length > 0 ? { transaction_ids: transactionIds } : {})
  };
  return {
    schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
    specVersion: '0.1.0',
    migration: input.mergePlan.migration,
    runId: record.runId,
    planId: input.mergePlan.mergePlanId,
    records: [record]
  };
}
function extractProposalTransactionIds(proposal: PatchProposal): readonly string[] {
  const values = [
    proposal.transactionId,
    ...(proposal.transactionIds ?? []),
    ...(proposal.transaction_ids ?? [])
  ];
  return values
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean);
}
function mapStewardMergeVerdict(verdict: MergePlan['verdict']): MergeVerdict {
  if (verdict === 'parallel-safe' || verdict === 'needs-steward') return 'mergeable';
  return 'conflict';
}
function hashText(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function stripShaPrefix(value: string): string {
  return value.replace(/^sha256:/, '');
}
function recomposeTerminalReasons(
  apply: TransactionalStewardApplyResult,
  attemptsUsed: number,
  attemptBudget: number
): readonly string[] {
  if (apply.receipt.verdict !== 're-compose' || attemptsUsed < attemptBudget) return apply.receipt.blockedReasons;
  return apply.receipt.blockedReasons.map((reason) => `re-compose attempts exhausted after ${attemptsUsed} of ${attemptBudget}: ${reason}`);
}
export function readGitHeadCommit(cwd: string): string | null {
  const result = spawnSync('git', ['-C', cwd, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const head = String(result.stdout ?? '').trim();
  return head.length > 0 ? head : null;
}
