import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  evaluateValidationContract,
  type ValidationContractCatalog,
  type ValidationContractChangeSet,
  type ValidationContractEvaluation,
  type ValidationContractEvidence,
  type ValidationContractTask
} from '../../../../core/src/evidence/validation-contract.ts';
import {
  evaluatePhaseSuitePromotion,
  type PhaseSuitePromotionInput,
  type PhaseSuitePromotionReport
} from '../../../../core/src/evidence/phase-suite.ts';
import { inspectStandardsSpecReviewReceipt, type ReviewAdvisoryReport } from '../../../../plugin-review-advisory/src/index.ts';
import { detectHistoricalDeliveryCommit } from '../tasks/historical-delivery.ts';
import { ATM_INDEX_FOREIGN_ACTIVE_STAGED } from '../git-index-ownership.ts';
import { buildHistoricalClosePreflight, preflightBlockersToWriteReadinessBlockers, type HistoricalClosePreflightSummary } from './historical-close-preflight.ts';
import { resolvePlanningPathFromStored } from '../planning-repo-root.ts';
import { resolveTaskflowDeclaredFiles } from './task-scope.ts';
import { quoteCliValue } from '../shared.ts';
import { isPathAllowedByScope } from '../work-channels.ts';
import { inspectTouchedPhysicalLineBudget } from '../git-governance/commit-scope-policy.ts';

export type { HistoricalClosePreflightSummary };

export interface TaskflowPlanningAuthorityDeliveryGate {
  required: boolean;
  ok: boolean;
  repoRoot: string | null;
  matchedFiles: string[];
  reason: string | null;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\\/g, '/')).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function extractTaskStringList(taskDocument: Record<string, unknown>, key: string): string[] {
  const value = taskDocument[key];
  return Array.isArray(value)
    ? value.map((entry) => typeof entry === 'string' ? entry.trim().replace(/\\/g, '/') : '').filter(Boolean)
    : [];
}

function normalizeTaskflowAuthority(taskDocument: Record<string, unknown>): string {
  return String(taskDocument.closureAuthority ?? taskDocument.closure_authority ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
}

function sourcePlanPathOf(taskDocument: Record<string, unknown>): string | null {
  const source = taskDocument.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const planPath = (source as Record<string, unknown>).planPath;
  return typeof planPath === 'string' && planPath.trim() ? planPath.trim() : null;
}

function taskflowPathMatches(filePath: string, declaredPath: string): boolean {
  return isPathAllowedByScope(filePath, [declaredPath]);
}

function resolvePlanningPath(cwd: string, planningMirrorPath: string | null): { repoRoot: string | null; relativePath: string | null; reason: string | null } {
  return resolvePlanningPathFromStored(cwd, planningMirrorPath);
}

export function extractTaskflowDeclaredFiles(cwd: string, taskId: string, taskDocument: Record<string, unknown>): string[] {
  const runtimeResolved = [...resolveTaskflowDeclaredFiles(cwd, taskId, taskDocument)]
    .filter((file) => !file.startsWith('.atm/'));
  const explicit = extractTaskStringList(taskDocument, 'deliverables');
  const deliverables = explicit.length > 0
    ? explicit
    : extractTaskStringList(taskDocument, 'scopePaths').filter((value) => value && !value.startsWith('.atm/') && !/[\\/]$/.test(value));
  return uniqueSorted(runtimeResolved.concat([
    ...extractTaskStringList(taskDocument, 'scopePaths'),
    ...deliverables,
    ...extractTaskStringList(taskDocument, 'targetAllowedFiles')
  ].filter((file) => !file.startsWith('.atm/'))));
}

export function inspectPlanningAuthorityDelivery(input: {
  cwd: string;
  taskDocument: Record<string, unknown>;
  historicalDeliveryRefs: string[];
  resolvedPlanningMirrorPath?: string | null;
}): TaskflowPlanningAuthorityDeliveryGate {
  if (normalizeTaskflowAuthority(input.taskDocument) !== 'planning_repo') {
    return { required: false, ok: false, repoRoot: null, matchedFiles: [], reason: null };
  }
  const planPath = input.resolvedPlanningMirrorPath ?? sourcePlanPathOf(input.taskDocument);
  const planning = resolvePlanningPath(input.cwd, planPath);
  if (!planning.repoRoot) {
    return { required: true, ok: false, repoRoot: null, matchedFiles: [], reason: planning.reason ?? 'planning repo could not be resolved' };
  }
  if (input.historicalDeliveryRefs.length === 0) {
    return { required: true, ok: false, repoRoot: planning.repoRoot, matchedFiles: [], reason: 'planning authority close requires --historical-delivery <planning-repo-commit>' };
  }
  const planningMirrorFile = planning.relativePath?.replace(/\\/g, '/') ?? null;
  const declaredFiles = extractTaskflowDeclaredFiles(input.cwd, String(input.taskDocument.workItemId ?? input.taskDocument.taskId ?? ''), input.taskDocument)
    .filter((entry) => entry.replace(/\\/g, '/') !== planningMirrorFile);
  const matchedFiles: string[] = [];
  for (const ref of input.historicalDeliveryRefs) {
    let commitSha: string | null = null;
    try {
      commitSha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
        cwd: planning.repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim() || null;
    } catch {
      commitSha = null;
    }
    if (!commitSha) continue;
    let changedFiles = '';
    try {
      changedFiles = execFileSync('git', ['show', '--pretty=format:', '--name-only', commitSha, '--'], {
        cwd: planning.repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch {
      changedFiles = '';
    }
    for (const file of changedFiles.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
      if (declaredFiles.some((declared) => taskflowPathMatches(file, declared))) {
        matchedFiles.push(file.replace(/\\/g, '/'));
      }
    }
  }
  const uniqueMatched = uniqueSorted(matchedFiles);
  return {
    required: true,
    ok: uniqueMatched.length > 0,
    repoRoot: planning.repoRoot,
    matchedFiles: uniqueMatched,
    reason: uniqueMatched.length > 0 ? null : 'planning delivery commit does not contain declared deliverable files'
  };
}

export function buildTaskflowClosePreflight(input: {
  cwd: string;
  taskId: string;
  actorId: string;
  taskDocument: Record<string, unknown>;
  previewCommitBundle: unknown;
  historicalDeliveryRefs: string[];
  deferForeignStaged?: boolean;
  waiverOutOfScopeDelivery: boolean;
  waiverReason: string | null;
}): HistoricalClosePreflightSummary {
  const historicalSummary = buildHistoricalClosePreflight({
    cwd: input.cwd,
    taskId: input.taskId,
    actorId: input.actorId || '<actor>',
    taskDocument: input.taskDocument,
    previewCommitBundle: input.previewCommitBundle as never,
    historicalDeliveryRefs: input.historicalDeliveryRefs,
    deferForeignStaged: input.deferForeignStaged,
    waiverOutOfScopeDelivery: input.waiverOutOfScopeDelivery,
    waiverReason: input.waiverReason
  });
  // The historical preflight delegates target-repo staged ownership to the
  // canonical index provider. This layer only consumes that result, so a
  // canonical empty result cannot revive a filename-derived false blocker.
  const summary = historicalSummary;
  const standardsSpecBlocker = buildStandardsSpecReviewReceiptBlocker({
    cwd: input.cwd,
    taskId: input.taskId,
    taskDocument: input.taskDocument
  });
  if (standardsSpecBlocker) {
    return {
      ...summary,
      ok: false,
      blockers: [standardsSpecBlocker, ...summary.blockers],
      operationalBlockers: [standardsSpecBlocker, ...summary.operationalBlockers]
    };
  }
  if (
    summary.unexpectedStagedTasks.length > 0
    && !input.deferForeignStaged
    && !summary.blockers.some((entry) => entry.id === 'unexpectedStagedTasks')
  ) {
    const files = [...new Set(summary.unexpectedStagedTasks.flatMap((entry) => entry.stagedFiles))];
    const taskIds = summary.unexpectedStagedTasks.map((entry) => entry.taskId);
    return {
      ...summary,
      ok: false,
      blockers: [
        {
          id: 'unexpectedStagedTasks',
          code: ATM_INDEX_FOREIGN_ACTIVE_STAGED,
          summary: `Git index contains staged governance files for other active tasks (${taskIds.join(', ')}). taskflow close --write will fail index isolation unless the owner commits, Broker grants an index lane, or an explicit stage-override lease is supplied.`,
          files,
          taskIds,
          remediationChoices: summary.unexpectedStagedTasks.map((entry) => ({
            id: 'defer-foreign-staged' as const,
            summary: entry.restoreChoice,
            requiredCommand: entry.deferCommand
          })),
          requiredCommand: summary.unexpectedStagedTasks[0]?.deferCommand ?? null
        },
        ...summary.blockers
      ],
      operationalBlockers: [
        {
          id: 'unexpectedStagedTasks',
          code: ATM_INDEX_FOREIGN_ACTIVE_STAGED,
          summary: `Git index contains staged governance files for other active tasks (${taskIds.join(', ')}). taskflow close --write will fail index isolation unless the owner commits, Broker grants an index lane, or an explicit stage-override lease is supplied.`,
          files,
          taskIds,
          remediationChoices: summary.unexpectedStagedTasks.map((entry) => ({
            id: 'defer-foreign-staged' as const,
            summary: entry.restoreChoice,
            requiredCommand: entry.deferCommand
          })),
          requiredCommand: summary.unexpectedStagedTasks[0]?.deferCommand ?? null
        },
        ...summary.operationalBlockers
      ]
    };
  }
  // Pre-close must not fail closed on another active task's oversized dirty WIP.
  // Foreign active dirty files stay advisory; line-budget admission only scans the
  // current task's touched source set (worktree porcelain minus foreign-active).
  const lineBudgetTouchedFiles = selectPreCloseLineBudgetTouchedFiles({
    cwd: input.cwd,
    foreignActiveDirtyFiles: summary.dirtyGuard.foreignActiveDirtyFiles ?? []
  });
  const lineBudgetReport = inspectTouchedPhysicalLineBudget(input.cwd, lineBudgetTouchedFiles, {
    taskId: input.taskId,
    actorId: input.actorId,
    gate: 'pre-close'
  });
  if (!lineBudgetReport.ok) {
    return {
      ...summary,
      ok: false,
      blockers: [
        {
          id: 'staleEvidence',
          code: 'ATM_TOUCHED_PHYSICAL_LINE_BUDGET_BLOCKED',
          summary: `Touched files exceed the physical line budget (${lineBudgetReport.maxLines}).`,
          files: lineBudgetReport.hardViolations.map((entry) => entry.file),
          taskIds: [input.taskId],
          remediationChoices: [],
          requiredCommand: lineBudgetReport.reproduceCommand
        },
        ...summary.blockers
      ],
      operationalBlockers: [
        {
          id: 'staleEvidence',
          code: 'ATM_TOUCHED_PHYSICAL_LINE_BUDGET_BLOCKED',
          summary: `Touched files exceed the physical line budget (${lineBudgetReport.maxLines}).`,
          files: lineBudgetReport.hardViolations.map((entry) => entry.file),
          taskIds: [input.taskId],
          remediationChoices: [],
          requiredCommand: lineBudgetReport.reproduceCommand
        },
        ...summary.operationalBlockers
      ]
    };
  }
  return summary;
}

function buildStandardsSpecReviewReceiptBlocker(input: {
  cwd: string;
  taskId: string;
  taskDocument: Record<string, unknown>;
}) {
  const nestedEvidence = input.taskDocument.evidence && typeof input.taskDocument.evidence === 'object' && !Array.isArray(input.taskDocument.evidence)
    ? input.taskDocument.evidence as Record<string, unknown>
    : {};
  const required = String(input.taskDocument.evidenceRequired ?? nestedEvidence.required ?? '').trim();
  if (required !== 'standards-spec-review-candidate-seal') {
    return null;
  }
  const report = readStandardsSpecReviewReport(input.cwd, input.taskId);
  const candidateDigest = digestTaskCandidate(input.cwd, extractTaskflowDeclaredFiles(input.cwd, input.taskId, input.taskDocument));
  const verdict = inspectStandardsSpecReviewReceipt({ report, taskId: input.taskId, candidateDigest });
  if (verdict.ok) {
    return null;
  }
  return {
    id: 'staleEvidence' as const,
    code: 'ATM_STANDARDS_SPEC_REVIEW_RECEIPT_REQUIRED',
    summary: `Standards/Spec review receipt is not close-ready: ${verdict.reason}.`,
    files: [
      `.atm/history/reports/review-advisory/${input.taskId}.json`,
      '.atm/history/reports/review-advisory.json'
    ],
    taskIds: [input.taskId],
    remediationChoices: [],
    requiredCommand: `node atm.mjs review-advisory --task ${input.taskId} --standards-spec-receipt --target-kind scope --target-id ${input.taskId} --out .atm/history/reports/review-advisory/${input.taskId}.json --json`
  };
}

function readStandardsSpecReviewReport(cwd: string, taskId: string): ReviewAdvisoryReport | null {
  for (const relativePath of [
    `.atm/history/reports/review-advisory/${taskId}.json`,
    '.atm/history/reports/review-advisory.json'
  ]) {
    const absolutePath = path.resolve(cwd, relativePath);
    if (!existsSync(absolutePath)) continue;
    try {
      return JSON.parse(readFileSync(absolutePath, 'utf8')) as ReviewAdvisoryReport;
    } catch {
      return null;
    }
  }
  return null;
}

function digestTaskCandidate(cwd: string, files: readonly string[]): string {
  const hash = createHash('sha256');
  for (const file of uniqueSorted(files)) {
    const absolutePath = path.resolve(cwd, file);
    hash.update(file.replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(existsSync(absolutePath) ? readFileSync(absolutePath) : Buffer.from('missing'));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function readTouchedFiles(cwd: string): string[] {
  const output = execFileSync('git', ['status', '--porcelain', '-uall'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return output
    .split(/\r?\n/)
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
    .map((file) => file.includes(' -> ') ? file.split(' -> ').pop() ?? file : file)
    .map((file) => file.replace(/\\/g, '/'));
}

export function selectPreCloseLineBudgetTouchedFiles(input: {
  readonly cwd: string;
  readonly foreignActiveDirtyFiles?: readonly string[];
  readonly readTouched?: (cwd: string) => readonly string[];
}): string[] {
  const foreign = new Set(
    (input.foreignActiveDirtyFiles ?? [])
      .map((file) => file.replace(/\\/g, '/').replace(/^\.\//, ''))
      .filter(Boolean)
  );
  const readTouched = input.readTouched ?? readTouchedFiles;
  return readTouched(input.cwd)
    .map((file) => file.replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter((file) => file.length > 0 && !foreign.has(file));
}

export function buildPlanningDeliveryRequiredCommand(taskId: string, actorId: string): string {
  return `node atm.mjs taskflow close --task ${taskId} --actor ${quoteCliValue(actorId || '<actor>')} --historical-delivery <commit> --write --json`;
}

// ─── TASK-SKL-0029: atm.validator-review-lifecycle-gate ─────────────────────
//
// Pre-close consumes the one validation contract instead of deriving its own
// required set or recomputing freshness. It fails closed on unresolved required
// cases, zero-test results, and stale phase ownership, while advisory checks
// remain non-blocking. The contract digest it seals here is the same digest the
// evidence run, close packet, and pre-push guard thread through the lifecycle.

export function resolveClosePreflightValidationContract(
  task: ValidationContractTask,
  changeSet: ValidationContractChangeSet,
  catalog: ValidationContractCatalog,
  evidence: ValidationContractEvidence = {}
): ValidationContractEvaluation {
  return evaluateValidationContract(task, changeSet, catalog, evidence);
}

/**
 * Deterministic digest of a validation-contract evaluation. Evidence run,
 * pre-close, close packet, and pre-push must all recompute the identical digest
 * from the same evaluation so a card cannot silently change its required set,
 * freshness, or phase ownership between stages.
 */
export function validationContractDigest(evaluation: ValidationContractEvaluation): string {
  const stable = JSON.stringify({
    evaluatorId: evaluation.evaluatorId,
    failClosed: evaluation.failClosed,
    requiredCaseIds: [...evaluation.requiredCaseIds].sort((a, b) => a.localeCompare(b)),
    phaseCaseIds: [...evaluation.phaseCaseIds].sort((a, b) => a.localeCompare(b)),
    advisoryCaseIds: [...evaluation.advisoryCaseIds].sort((a, b) => a.localeCompare(b)),
    phaseOwners: [...evaluation.phaseOwners]
      .map((entry) => ({ phase: entry.phase, caseIds: [...entry.caseIds].sort((a, b) => a.localeCompare(b)) }))
      .sort((a, b) => a.phase.localeCompare(b.phase)),
    freshness: [...evaluation.freshnessInputs]
      .map((entry) => ({ caseId: entry.caseId, status: entry.status }))
      .sort((a, b) => a.caseId.localeCompare(b.caseId))
  });
  return `validation-contract:${createHash('sha256').update(stable).digest('hex').slice(0, 16)}`;
}

export interface ValidatorReviewLifecycleRequiredReceipt {
  readonly caseId: string;
  readonly status: 'passed' | 'failed' | 'missing' | 'stale';
  readonly executedCaseCount: number;
}

export interface ValidatorReviewLifecycleGateInput {
  readonly evaluation: ValidationContractEvaluation;
  readonly requiredReceipts?: readonly ValidatorReviewLifecycleRequiredReceipt[];
  readonly phaseSuite?: PhaseSuitePromotionInput;
}

export interface ValidatorReviewLifecycleGateBlocker {
  readonly code: string;
  readonly reason: string;
  readonly caseIds: readonly string[];
}

export interface ValidatorReviewLifecycleGateReport {
  readonly ok: boolean;
  readonly failClosed: boolean;
  readonly contractDigest: string;
  readonly blockers: readonly ValidatorReviewLifecycleGateBlocker[];
  readonly phaseReport: PhaseSuitePromotionReport | null;
}

/**
 * The fail-closed pre-close gate. Blocks on unresolved required cases, zero-test
 * results, and stale phase ownership; advisory selections never block.
 */
export function evaluateValidatorReviewLifecycleGate(
  input: ValidatorReviewLifecycleGateInput
): ValidatorReviewLifecycleGateReport {
  const evaluation = input.evaluation;
  const contractDigest = validationContractDigest(evaluation);
  const blockers: ValidatorReviewLifecycleGateBlocker[] = [];

  // (1) A missing required contract fails closed — never default to a full run.
  if (evaluation.failClosed) {
    blockers.push({
      code: 'ATM_VALIDATION_CONTRACT_MISSING_REQUIRED_SET',
      reason: 'validation contract is missing a task-required set; pre-close fails closed instead of running the full repository',
      caseIds: []
    });
    return { ok: false, failClosed: true, contractDigest, blockers, phaseReport: null };
  }

  const requiredIds = new Set(evaluation.requiredCaseIds);

  // (2) Required cases whose freshness is not fresh are unresolved.
  const unresolved = evaluation.freshnessInputs
    .filter((entry) => requiredIds.has(entry.caseId) && entry.status !== 'fresh')
    .map((entry) => entry.caseId);
  if (unresolved.length > 0) {
    blockers.push({
      code: 'ATM_CLOSE_PRECHECK_REQUIRED_CASE_UNRESOLVED',
      reason: `required validation cases are missing, stale, or failed: ${unresolved.join(', ')}`,
      caseIds: unresolved
    });
  }

  // (3) Zero-test: a required case whose receipt executed no cases.
  const receiptById = new Map((input.requiredReceipts ?? []).map((entry) => [entry.caseId, entry]));
  const zeroTest = [...requiredIds].filter((caseId) => {
    const receipt = receiptById.get(caseId);
    return receipt !== undefined && receipt.status === 'passed' && receipt.executedCaseCount <= 0;
  });
  if (zeroTest.length > 0) {
    blockers.push({
      code: 'ATM_CLOSE_PRECHECK_ZERO_TEST_RESULT',
      reason: `required validation cases reported success without executing any case: ${zeroTest.join(', ')}`,
      caseIds: zeroTest
    });
  }

  // (4) Stale phase ownership via the single phase-suite evaluator.
  let phaseReport: PhaseSuitePromotionReport | null = null;
  if (input.phaseSuite) {
    phaseReport = evaluatePhaseSuitePromotion(input.phaseSuite);
    const staleBlockers = phaseReport.blockers.filter((entry) => entry.reason === 'stale');
    if (staleBlockers.length > 0) {
      blockers.push({
        code: 'ATM_CLOSE_PRECHECK_STALE_PHASE_OWNERSHIP',
        reason: `phase-suite ownership is stale for: ${staleBlockers.map((entry) => entry.caseId).join(', ')}`,
        caseIds: staleBlockers.map((entry) => entry.caseId)
      });
    }
  }

  return { ok: blockers.length === 0, failClosed: false, contractDigest, blockers, phaseReport };
}

export { preflightBlockersToWriteReadinessBlockers };
