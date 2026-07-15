// @ts-nocheck
import { buildFrameworkStaleCleanupCommand, isFrameworkStaleLockReleasable } from '../../framework-development.ts';
import { normalizeRelativePath } from '../git-index-diagnostics.ts';

const INVARIANT_TASK_AUDIT_CODES: ReadonlySet<string> = new Set([
  'ATM_TASK_AUDIT_CROSS_REPO_DONE_WITHOUT_PACKET',
  'ATM_TASK_AUDIT_BULK_CLOSE_WITHOUT_MANIFEST'
]);

export interface PreCommitBlockingFinding {
  readonly code: string;
  readonly source: string;
  readonly detail: string;
  readonly file?: string;
  readonly files?: readonly string[];
  readonly requiredCommand?: string | null;
  readonly classification?: 'environment' | 'baseline' | 'current-task' | 'blocking';
  readonly blockerKind?: 'governance-state' | 'content-validation' | 'environment' | 'baseline';
  readonly scope?: 'staged' | 'tree-wide';
  readonly data?: unknown;
}

export interface PreCommitFailureEnvelope {
  readonly schemaId: 'atm.validatorFailureEnvelope.v1';
  readonly ok: false;
  readonly surface: 'pre-commit';
  readonly requiredCommand: string | null;
  readonly blockingFindings: readonly PreCommitBlockingFinding[];
  readonly baselineFailures: readonly PreCommitBlockingFinding[];
  readonly currentTaskFailures: readonly PreCommitBlockingFinding[];
  readonly governanceStateFailures: readonly PreCommitBlockingFinding[];
  readonly contentValidationFailures: readonly PreCommitBlockingFinding[];
  readonly deferredGovernanceCandidate: boolean;
  readonly repairHints: readonly string[];
  readonly diagnostics: {
    readonly gitIndexDiagnostic: unknown;
    readonly failedValidators: readonly { readonly command: string; readonly exitCode: number; readonly stdoutSha256: string; readonly stderrSha256: string; }[];
  };
}

export function buildPreCommitBlockingFindings(input: any): readonly PreCommitBlockingFinding[] {
  const findings: PreCommitBlockingFinding[] = [];
  if (!input.gitIndexDiagnostic.ok) {
    findings.push({
      code: input.gitIndexDiagnostic.code,
      source: 'git-index',
      detail: input.gitIndexDiagnostic.detail,
      requiredCommand: input.gitIndexDiagnostic.requiredCommand,
      classification: 'environment',
      data: input.gitIndexDiagnostic
    });
  }
  findings.push(...input.crossFileConsistencyFindings);
  findings.push(...input.commitAttributionFindings);
  for (const finding of input.residueFindings) {
    findings.push({
      code: finding.verdict === 'block-and-explain'
        ? 'ATM_HOOK_GENERATED_RESIDUE_BLOCKED'
        : 'ATM_HOOK_GENERATED_RESIDUE_MANUAL_REVIEW',
      source: 'generated-residue',
      file: finding.path,
      detail: finding.reason,
      classification: 'current-task'
    });
  }
  for (const finding of input.emergencyUseAuditFindings) {
    findings.push({
      code: finding.code,
      source: 'emergency-use-audit',
      file: finding.file,
      detail: finding.detail,
      requiredCommand: null,
      classification: 'current-task',
      data: finding
    });
  }
  for (const finding of input.encodingReport.findings) {
    findings.push({
      code: `ATM_ENCODING_${finding.issue.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
      source: 'encoding',
      file: finding.file,
      detail: `Encoding guard found ${finding.issue} in ${finding.file}.`,
      classification: 'current-task'
    });
  }
  for (const blocker of input.blockingFrameworkIssues) {
    findings.push({
      code: `ATM_FRAMEWORK_${blocker.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
      source: 'framework-development',
      detail: `Framework-development gate blocked this commit: ${blocker}.`,
      requiredCommand: blocker === 'active-framework-claim-required' ? input.frameworkClaimCommand : null,
      classification: 'current-task'
    });
  }
  for (const stale of input.staleLocks) {
    const requiredCommand = isFrameworkStaleLockReleasable(stale)
      ? (input.frameworkClaimCommand ?? buildFrameworkStaleCleanupCommand(stale))
      : stale.requiredCommand;
    findings.push({
      code: 'ATM_FRAMEWORK_STALE_LOCK_CLEANUP_REQUIRED',
      source: 'framework-development',
      detail: stale.detail,
      requiredCommand,
      classification: stale.kind === 'still-active' ? 'blocking' : 'current-task',
      data: {
        kind: stale.kind,
        lockTaskId: stale.lockTaskId,
        lockPath: stale.lockPath,
        linkedTaskId: stale.linkedTaskId,
        currentTaskId: stale.currentTaskId,
        actorId: stale.actorId
      }
    });
  }
  if (input.planningMirrorDriftFiles.length > 0) {
    findings.push({
      code: 'ATM_PLANNING_MIRROR_DRIFT',
      source: 'direction-lock',
      files: input.planningMirrorDriftFiles,
      detail: 'Staged files include planning/mirror paths while the active direction lock allows target work only.',
      classification: 'current-task'
    });
  }
  if (input.directionLockDriftFiles.length > 0) {
    findings.push({
      code: 'ATM_TASK_DIRECTION_SCOPE_DRIFT',
      source: 'direction-lock',
      files: input.directionLockDriftFiles,
      detail: 'Staged files are outside the active task direction lock allowedFiles.',
      classification: 'current-task'
    });
  }
  if (input.quickfixDriftFiles.length > 0) {
    findings.push({
      code: 'ATM_QUICKFIX_SCOPE_DRIFT',
      source: 'quickfix',
      files: input.quickfixDriftFiles,
      detail: 'Staged files are outside the active quickfix allowedFiles.',
      classification: 'current-task'
    });
  }
  if (input.quickfixFileLimitExceeded) {
    findings.push({
      code: 'ATM_QUICKFIX_FILE_LIMIT_EXCEEDED',
      source: 'quickfix',
      detail: 'Quickfix changed too many non-.atm files for the fast channel.',
      classification: 'current-task'
    });
  }
  if (input.quickfixLineLimitExceeded) {
    findings.push({
      code: 'ATM_QUICKFIX_LINE_LIMIT_EXCEEDED',
      source: 'quickfix',
      detail: `Quickfix changed ${input.quickfixChangedLineCount} lines, exceeding the fast-channel line limit.`,
      classification: 'current-task'
    });
  }
  for (const finding of input.protectedStateFindings) {
    findings.push({
      code: `ATM_PROTECTED_STATE_${finding.reason.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
      source: 'protected-atm-state',
      file: finding.file,
      detail: finding.detail,
      requiredCommand: finding.requiredCommand ?? null,
      classification: 'current-task'
    });
  }
  for (const finding of input.taskCardStatusFindings) {
    findings.push({
      code: 'ATM_TASK_CARD_STATUS_DONE_REQUIRES_LEDGER_CLOSURE',
      source: 'task-card-status',
      file: finding.file,
      detail: finding.detail,
      requiredCommand: finding.requiredCommand,
      classification: 'current-task',
      data: finding
    });
  }
  for (const finding of input.sameFileClaimFindings) {
    findings.push({
      code: finding.code,
      source: 'same-file-claim-ownership',
      file: finding.file,
      detail: finding.detail,
      requiredCommand: finding.requiredCommand,
      classification: 'current-task',
      data: finding
    });
  }
  // TASK-AAO-0136: scope-classify task-audit findings.
  //   staged   -> blocking (current-task) — the author's commit ships the offending change
  //   tree-wide -> advisory warning — pre-existing tree state, do not block other commits
  // INV-ATM-* invariant violations still block regardless of scope.
  const stagedSet = new Set(input.stagedFiles);
  for (const finding of input.taskAuditFindings.filter((entry) => entry.level === 'error')) {
    const findingPath = 'path' in finding && typeof finding.path === 'string' ? finding.path : undefined;
    const isInvariantViolation = INVARIANT_TASK_AUDIT_CODES.has(finding.code);
    const isStaged = findingPath ? stagedSet.has(findingPath) : false;
    const scope: 'staged' | 'tree-wide' = isStaged ? 'staged' : 'tree-wide';
    if (scope === 'staged' || isInvariantViolation) {
      findings.push({
        code: finding.code,
        source: 'task-audit',
        file: findingPath,
        detail: finding.detail,
        classification: 'current-task',
        scope
      });
    } else {
      input.advisoryFindingsSink.push({
        code: finding.code,
        source: 'task-audit',
        file: findingPath,
        detail: finding.detail,
        scope: 'tree-wide',
        taskId: 'taskId' in finding && typeof finding.taskId === 'string' ? finding.taskId : undefined
      });
    }
  }
  for (const run of input.failedValidatorRuns) {
    findings.push({
      code: 'ATM_FRAMEWORK_VALIDATOR_FAILED',
      source: 'framework-validator',
      detail: `${run.command} exited with ${run.exitCode}.`,
      classification: 'current-task',
      data: {
        command: run.command,
        exitCode: run.exitCode,
        stdoutSha256: run.stdoutSha256,
        stderrSha256: run.stderrSha256
      }
    });
  }
  return findings;
}

export function selectActionableResidueFindings(input: any): readonly any[] {
  const staged = new Set(input.stagedFiles.map(normalizeRelativePath));
  const taskId = input.committingTaskId?.trim().toUpperCase() ?? null;
  const ownersWithNonDeferrableForeignResidue = new Set<string>();
  for (const finding of input.findings) {
    if (finding.verdict !== 'block-and-explain') continue;
    const owner = finding.ownerTaskId?.trim().toUpperCase() ?? null;
    if (!owner || owner === taskId) continue;
    if (!isDeferrableForeignGovernanceResidue(finding)) {
      ownersWithNonDeferrableForeignResidue.add(owner);
    }
  }
  return input.findings.filter((finding) => {
    if (finding.verdict === 'block-and-explain') {
      // TASK-AAO-FABLE-005: an unstaged governance artifact owned by a
      // DIFFERENT task with a live direction lock is another agent's
      // in-flight close state, not orphaned residue. Blocking here made two
      // captains mutually unable to commit while either had uncommitted
      // evidence. Live foreign ownership is the safety proof; orphaned
      // artifacts (owner without an active lock) stay fail-closed, and
      // anything actually staged into this commit still blocks.
      const owner = finding.ownerTaskId?.trim().toUpperCase() ?? null;
      const stagedHere = staged.has(normalizeRelativePath(finding.path));
      if (!stagedHere && owner && owner !== taskId
        && !ownersWithNonDeferrableForeignResidue.has(owner)
        && isDeferrableForeignGovernanceResidue(finding)
        && (input.activeLockTaskIds.has(owner) || input.hasActiveClaim(owner) || input.hasTerminalOwner(owner))) {
        return false;
      }
      return true;
    }
    if (staged.has(normalizeRelativePath(finding.path))) return true;
    return taskId !== null && finding.ownerTaskId?.trim().toUpperCase() === taskId;
  });
}

function isDeferrableForeignGovernanceResidue(finding: AutoGeneratedResidueFinding): boolean {
  const normalized = normalizeRelativePath(finding.path).toLowerCase();
  return /^\.atm\/history\/evidence\/[^/]+\.bundle-manifest\.json$/.test(normalized)
    || /^\.atm\/history\/task-events\/[^/]+\/.+(?:close|reconcile|repair-closure).+\.json$/.test(normalized);
}

export function buildPreCommitFailureEnvelope(input: any): PreCommitFailureEnvelope {
  const requiredCommand = input.blockingFindings.find((entry) => entry.requiredCommand)?.requiredCommand
    ?? input.frameworkClaimCommand
    ?? null;
  const baselineFailures = input.blockingFindings.filter(isPreCommitBaselineFinding);
  const currentTaskFailures = input.blockingFindings.filter((finding) => !isPreCommitBaselineFinding(finding) && !isPreCommitEnvironmentFinding(finding));
  const governanceStateFailures = currentTaskFailures.filter(isPreCommitGovernanceStateFinding);
  const contentValidationFailures = currentTaskFailures.filter((finding) => !isPreCommitGovernanceStateFinding(finding));
  return {
    schemaId: 'atm.validatorFailureEnvelope.v1',
    ok: false,
    surface: 'pre-commit',
    requiredCommand,
    blockingFindings: input.blockingFindings,
    baselineFailures,
    currentTaskFailures,
    governanceStateFailures,
    contentValidationFailures,
    deferredGovernanceCandidate: governanceStateFailures.length > 0 && contentValidationFailures.length === 0,
    repairHints: buildPreCommitRepairHints(input.blockingFindings, requiredCommand),
    diagnostics: {
      gitIndexDiagnostic: input.gitIndexDiagnostic,
      failedValidators: input.failedValidatorRuns.map((entry) => ({
        command: entry.command,
        exitCode: entry.exitCode,
        stdoutSha256: entry.stdoutSha256,
        stderrSha256: entry.stderrSha256
      }))
    }
  };
}

export function buildPreCommitRepairHints(
  findings: readonly PreCommitBlockingFinding[],
  requiredCommand: string | null
): readonly string[] {
  if (findings.length === 0) {
    return requiredCommand ? [`Run required command: ${sanitizeOperatorCommandHint(requiredCommand)}`] : [];
  }
  return findings.map((finding) => {
    if (finding.code === 'ATM_ENV_SANDBOX_GIT_EPERM') {
      return 'Rerun the commit with repository-level Git permissions, or set ATM_TEMP_ROOT=C:\\tmp for validators that create temporary Git repositories.';
    }
    if (finding.code === 'ATM_GIT_INDEX_PERMISSION_DENIED') {
      return 'Resolve the local Git/index permission problem outside ATM, then retry the commit. This is an environment diagnostic, not task evidence.';
    }
    if (finding.requiredCommand) {
      return `Run required command: ${sanitizeOperatorCommandHint(finding.requiredCommand)}`;
    }
    return `Resolve ${finding.source} finding ${finding.code}, then retry with the ATM governed command.`;
  });
}

export function summarizePreCommitFailureEnvelope(envelope: PreCommitFailureEnvelope): string {
  const first = envelope.currentTaskFailures[0] ?? envelope.baselineFailures[0] ?? envelope.blockingFindings[0] ?? null;
  const summary = first
    ? `${first.code}: ${first.detail}`
    : 'ATM pre-commit blocked this commit.';
  const next = envelope.requiredCommand
    ? ` Next: ${sanitizeOperatorCommandHint(envelope.requiredCommand)}`
    : ' Next: inspect failureEnvelope.blockingFindings and rerun the ATM governed command.';
  return `${summary}${next}`;
}

function sanitizeOperatorCommandHint(command: string): string {
  const normalized = command.trim();
  if (/\bgit\s+(reset|clean|checkout|restore|read-tree|rm|switch)\b/i.test(normalized)) {
    return 'use the ATM repair/reconcile command shown by the blocking finding; do not run raw destructive Git remediation';
  }
  if (/\bgit\s+commit\b/i.test(normalized) && !/\batm\.mjs\s+git\s+commit\b/i.test(normalized)) {
    return 'node atm.mjs git commit --actor <actor> --task <task> --message "<message>" --json';
  }
  if (/\bgit\s+push\b/i.test(normalized) && !/\batm\.mjs\s+git\s+push\b/i.test(normalized)) {
    return 'node atm.mjs git push --actor <actor> --task <task> --json';
  }
  return normalized;
}

export function isPreCommitBaselineFinding(finding: PreCommitBlockingFinding): boolean {
  return finding.classification === 'baseline' || finding.source === 'baseline';
}

export function isPreCommitEnvironmentFinding(finding: PreCommitBlockingFinding): boolean {
  return finding.classification === 'environment'
    || finding.source === 'environment'
    || finding.source === 'git-index'
    || finding.code.startsWith('ATM_ENV_')
    || finding.code.startsWith('ATM_GIT_INDEX_');
}

function isPreCommitGovernanceStateFinding(finding: PreCommitBlockingFinding): boolean {
  if (finding.blockerKind) {
    return finding.blockerKind === 'governance-state';
  }
  return finding.source === 'framework-development'
    || finding.source === 'direction-lock'
    || finding.source === 'quickfix'
    || finding.source === 'protected-atm-state'
    || finding.source === 'same-file-claim-ownership'
    || finding.source === 'generated-residue'
    || finding.source === 'emergency-use-audit';
}

