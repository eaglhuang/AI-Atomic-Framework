import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message, readFrameworkVersion, relativePathFrom } from './shared.ts';
import { createGitHeadEvidenceCheck } from './git-head-evidence.ts';
import { bootstrapTaskId, detectGovernanceRuntime } from './governance-runtime.ts';
import {
  externalTaskKey,
  readTaskLedgerPolicy,
  resolveTaskLedgerMode,
  transitionEventExists,
  type TaskLedgerMode,
  type TaskLedgerPolicy
} from './task-ledger.ts';

export type FrameworkMode = 'inactive' | 'suspected' | 'required' | 'cross-repo-target-required';
export type ClosureAuthority = 'local' | 'target_repo' | 'none';

export interface FrameworkRepoIdentity {
  readonly isFrameworkRepo: boolean;
  readonly score: number;
  readonly root: string;
  readonly name: string | null;
  readonly signals: readonly string[];
}

export interface FrameworkModeStatusReport {
  readonly schemaId: 'atm.frameworkDevelopmentStatus';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly repoRole: 'framework' | 'host';
  readonly repoIdentity: FrameworkRepoIdentity;
  readonly targetRepo: string | null;
  readonly targetRepoIdentity: FrameworkRepoIdentity | null;
  readonly mode: FrameworkMode;
  readonly closureAuthority: ClosureAuthority;
  readonly taskLedgerMode: TaskLedgerMode;
  readonly taskLedger: TaskLedgerPolicy;
  readonly changedFiles: readonly string[];
  readonly criticalChangedFiles: readonly string[];
  readonly docsOnlyChangedFiles: readonly string[];
  readonly requiredGates: readonly string[];
  readonly activeLocks: readonly string[];
  readonly pinnedRunner: PinnedRunnerStatus;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
}

export interface PinnedRunnerStatus {
  readonly status: 'available' | 'missing' | 'source-unavailable';
  readonly metadataPath: string;
  readonly sourcePath: string | null;
  readonly runnerPath: string | null;
  readonly reason: string | null;
}

export interface ClosurePacketCommandRun {
  readonly command: string;
  readonly cwd: string;
  readonly exitCode: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly runnerVersion: string;
}

export interface ClosurePacket {
  readonly schemaId: 'atm.closurePacket.v1';
  readonly specVersion: '0.1.0';
  readonly taskId: string;
  readonly targetRepoIdentity: FrameworkRepoIdentity;
  readonly targetCommit: string | null;
  readonly governedTreeSha: string | null;
  readonly closedByCommand: 'atm tasks close';
  readonly commandRuns: readonly ClosurePacketCommandRun[];
  readonly requiredGates: readonly string[];
  readonly evidencePath: string;
  readonly closedAt: string;
  readonly closedByActor: string;
}

export interface TaskAuditFinding {
  readonly level: 'error' | 'warning';
  readonly code: string;
  readonly path: string;
  readonly taskId?: string;
  readonly detail: string;
}

export interface TaskAuditReport {
  readonly schemaId: 'atm.taskAuditReport';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly repoIdentity: FrameworkRepoIdentity;
  readonly inspectedTaskCount: number;
  readonly inspectedEvidenceCount: number;
  readonly findings: readonly TaskAuditFinding[];
  readonly ok: boolean;
}

interface FrameworkModeOptions {
  readonly cwd: string;
  readonly files?: readonly string[];
  readonly targetRepo?: string | null;
}

interface ParsedFrameworkModeArgs {
  readonly cwd: string;
  readonly action: 'status';
  readonly files: readonly string[];
  readonly targetRepo: string | null;
}

const frameworkModeSpecVersion = '0.1.0';
const defaultRequiredGates = [
  'framework-development',
  'tasks-audit',
  'doctor',
  'git-head-evidence',
  'typecheck',
  'validate:cli',
  'validate:git-head-evidence'
] as const;

const defaultIgnoredDirs = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'release',
  '.atm-temp'
]);

const markdownCompletionPatterns = [
  /status:\s*\*\*(?:all\s+)?completed\*\*/i,
  /\bALL\s+COMPLETED\b/i,
  /\b16\s*\/\s*16\b/i,
  /\b100%\s*\(?\s*completed\s*\)?/i
];

export function runFrameworkMode(argv: string[]) {
  const options = parseFrameworkModeArgs(argv);
  const report = createFrameworkModeStatus({
    cwd: options.cwd,
    files: options.files,
    targetRepo: options.targetRepo
  });
  return makeResult({
    ok: true,
    command: 'framework-mode',
    cwd: options.cwd,
    messages: [
      message('info', 'ATM_FRAMEWORK_MODE_STATUS', `Framework development mode is ${report.mode}.`, {
        mode: report.mode,
        repoRole: report.repoRole,
        criticalChangedFileCount: report.criticalChangedFiles.length,
        closureAuthority: report.closureAuthority
      })
    ],
    evidence: {
      action: options.action,
      report
    }
  });
}

export function runFrameworkDevelopmentGuard(cwd: string, files: readonly string[] = []) {
  const report = createFrameworkModeStatus({ cwd, files });
  const ok = report.blockers.length === 0;
  return makeResult({
    ok,
    command: 'guard',
    cwd,
    messages: [
      ok
        ? message('info', 'ATM_GUARD_FRAMEWORK_DEVELOPMENT_OK', 'Framework development guard passed.', {
          mode: report.mode,
          criticalChangedFileCount: report.criticalChangedFiles.length
        })
        : message('error', 'ATM_GUARD_FRAMEWORK_DEVELOPMENT_FAILED', 'Framework development guard found blocking issues.', {
          mode: report.mode,
          blockers: report.blockers
        })
    ],
    evidence: {
      guard: 'framework-development',
      report
    }
  });
}

export function runFrameworkDevelopmentValidation(cwd: string, files: readonly string[] = []) {
  const report = createFrameworkModeStatus({ cwd, files });
  const taskAudit = auditTasks(cwd);
  const ok = report.blockers.length === 0 && taskAudit.ok;
  return makeResult({
    ok,
    command: 'validate',
    cwd,
    messages: [
      ok
        ? message('info', 'ATM_VALIDATE_FRAMEWORK_DEVELOPMENT_OK', 'Framework development validation passed.', {
          mode: report.mode,
          criticalChangedFileCount: report.criticalChangedFiles.length
        })
        : message('error', 'ATM_VALIDATE_FRAMEWORK_DEVELOPMENT_FAILED', 'Framework development validation failed.', {
          mode: report.mode,
          blockers: report.blockers,
          taskAuditFindings: taskAudit.findings.length
        })
    ],
    evidence: {
      validation: 'framework-development',
      report,
      taskAudit
    }
  });
}

export function createFrameworkModeStatus(input: FrameworkModeOptions): FrameworkModeStatusReport {
  const cwd = path.resolve(input.cwd);
  const generatedAt = new Date().toISOString();
  const repoIdentity = detectFrameworkRepoIdentity(cwd);
  const targetRepo = input.targetRepo ? path.resolve(cwd, input.targetRepo) : null;
  const targetRepoIdentity = targetRepo ? detectFrameworkRepoIdentity(targetRepo) : null;
  const taskLedger = readTaskLedgerPolicy(cwd);
  const declaredFiles = (input.files ?? []).map((entry) => normalizeRelativePath(entry)).filter(Boolean);
  const changedFiles = declaredFiles.length > 0 ? uniqueSorted(declaredFiles) : readChangedFiles(cwd);
  const criticalChangedFiles = repoIdentity.isFrameworkRepo
    ? changedFiles.filter(isAtmCriticalNonDocSurface)
    : [];
  const docsOnlyChangedFiles = repoIdentity.isFrameworkRepo
    ? changedFiles.filter((entry) => !isAtmCriticalNonDocSurface(entry))
    : [];
  const activeLocks = readActiveLockPaths(cwd);
  const pinnedRunner = inspectPinnedRunner(cwd);
  const requiredGates = buildRequiredGates(criticalChangedFiles);
  let mode: FrameworkMode = 'inactive';
  let closureAuthority: ClosureAuthority = 'none';
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (targetRepoIdentity?.isFrameworkRepo && !sameRepo(cwd, targetRepo)) {
    mode = 'cross-repo-target-required';
    closureAuthority = 'target_repo';
    blockers.push('closure-authority-belongs-to-target-repo');
  } else if (repoIdentity.isFrameworkRepo && criticalChangedFiles.length > 0) {
    mode = 'required';
    closureAuthority = 'local';
  } else if (repoIdentity.isFrameworkRepo && changedFiles.length > 0) {
    mode = 'suspected';
    closureAuthority = 'local';
  }

  if ((mode === 'required' || mode === 'cross-repo-target-required') && pinnedRunner.status !== 'available') {
    blockers.push('pinned-runner-missing');
  }

  if (mode === 'required') {
    const gitHead = createGitHeadEvidenceCheck(cwd, detectGovernanceRuntime(cwd, bootstrapTaskId));
    if (!gitHead.ok) {
      blockers.push('git-head-evidence-missing');
    }
  }
  const taskLedgerMode = resolveTaskLedgerMode({
    policy: taskLedger,
    frameworkMode: mode,
    repoRole: repoIdentity.isFrameworkRepo ? 'framework' : 'host',
    closureAuthority
  });

  return {
    schemaId: 'atm.frameworkDevelopmentStatus',
    specVersion: frameworkModeSpecVersion,
    generatedAt,
    repoRole: repoIdentity.isFrameworkRepo ? 'framework' : 'host',
    repoIdentity,
    targetRepo,
    targetRepoIdentity,
    mode,
    closureAuthority,
    taskLedgerMode,
    taskLedger,
    changedFiles,
    criticalChangedFiles,
    docsOnlyChangedFiles,
    requiredGates,
    activeLocks,
    pinnedRunner,
    blockers,
    warnings
  };
}

export function detectFrameworkRepoIdentity(repositoryRoot: string): FrameworkRepoIdentity {
  const root = path.resolve(repositoryRoot);
  const packageJson = readJsonIfExists(path.join(root, 'package.json'));
  const signals: string[] = [];
  const packageName = typeof packageJson?.name === 'string' ? packageJson.name : null;
  if (packageName === 'ai-atomic-framework') {
    signals.push('package-name:ai-atomic-framework');
  }
  if (existsSync(path.join(root, 'packages', 'core', 'src', 'index.ts'))) {
    signals.push('packages/core/src/index.ts');
  }
  if (existsSync(path.join(root, 'packages', 'cli', 'src', 'atm.ts'))) {
    signals.push('packages/cli/src/atm.ts');
  }
  if (existsSync(path.join(root, 'atomic-registry.json'))) {
    signals.push('atomic-registry.json');
  }
  const workspaces = Array.isArray(packageJson?.workspaces) ? packageJson.workspaces.map((entry: unknown) => String(entry)) : [];
  if (workspaces.includes('packages/*')) {
    signals.push('workspace:packages/*');
  }

  return {
    isFrameworkRepo: signals.length >= 2,
    score: signals.length,
    root,
    name: packageName,
    signals
  };
}

export function isAtmCriticalNonDocSurface(filePath: string): boolean {
  const relativePath = normalizeRelativePath(filePath);
  if (!relativePath || isDocOnlyPath(relativePath)) {
    return false;
  }
  if (relativePath === 'atm.mjs') return true;
  if (relativePath === 'package.json' || relativePath === 'package-lock.json') return true;
  if (/^tsconfig[^/]*\.json$/.test(relativePath)) return true;
  if (relativePath === 'atomic-registry.json') return true;
  if (/^compatibility-matrix[^/]*\.json$/.test(relativePath)) return true;
  return /^(packages|schemas|specs|scripts|templates|integrations|examples|tests)\//.test(relativePath);
}

export function auditTasks(cwd: string): TaskAuditReport {
  const root = path.resolve(cwd);
  const generatedAt = new Date().toISOString();
  const repoIdentity = detectFrameworkRepoIdentity(root);
  const taskLedger = readTaskLedgerPolicy(root);
  const findings: TaskAuditFinding[] = [];
  const taskDocs = readTaskDocuments(root);
  const evidenceDocs = readEvidenceDocuments(root);
  const mirrorKeys = new Set<string>();

  for (const task of taskDocs) {
    const originProvider = normalizeOptionalString(task.document.originProvider ?? task.document.origin_provider);
    const originTaskId = normalizeOptionalString(task.document.originTaskId ?? task.document.origin_task_id);
    const syncStatus = normalizeOptionalString(task.document.syncStatus ?? task.document.sync_status);
    if (originProvider && originTaskId) {
      mirrorKeys.add(externalTaskKey(originProvider, originTaskId));
      if (!syncStatus) {
        findings.push({
          level: 'error',
          code: 'ATM_TASK_AUDIT_MIRROR_SYNC_STATUS_MISSING',
          path: task.relativePath,
          taskId: task.taskId,
          detail: `Mirror task ${task.taskId} must declare syncStatus.`
        });
      }
    } else if (originProvider || originTaskId) {
      findings.push({
        level: 'error',
        code: 'ATM_TASK_AUDIT_MIRROR_ORIGIN_INCOMPLETE',
        path: task.relativePath,
        taskId: task.taskId,
        detail: `Mirror task ${task.taskId} must declare both originProvider and originTaskId.`
      });
    }

    const lastTransitionId = normalizeOptionalString(task.document.lastTransitionId ?? task.document.last_transition_id);
    const hasTransitionEvent = Boolean(lastTransitionId && transitionEventExists(root, task.taskId, lastTransitionId));
    const transitionRequired = taskLedger.enabled
      && taskLedger.provider === 'atm-local'
      && taskLedger.requireCliTransitions
      && (task.status === 'done' || Boolean(originProvider || originTaskId));
    if (transitionRequired && !lastTransitionId) {
      findings.push({
        level: 'error',
        code: 'ATM_TASK_AUDIT_TRANSITION_EVIDENCE_MISSING',
        path: task.relativePath,
        taskId: task.taskId,
        detail: `Task ${task.taskId} is missing lastTransitionId; status transitions must use ATM CLI.`
      });
    } else if (lastTransitionId && !hasTransitionEvent) {
      findings.push({
        level: 'error',
        code: 'ATM_TASK_AUDIT_TRANSITION_EVENT_MISSING',
        path: task.relativePath,
        taskId: task.taskId,
        detail: `Task ${task.taskId} references missing transition event ${lastTransitionId}.`
      });
    }

    if (task.status !== 'done') continue;
    const closureAuthority = normalizeClosureAuthority(task.document.closure_authority ?? task.document.closureAuthority);
    const targetRepo = normalizeOptionalString(task.document.target_repo ?? task.document.targetRepo ?? task.document.upstream_repo ?? task.document.upstreamRepo);
    const closurePacketRef = normalizeOptionalString(task.document.closure_packet ?? task.document.closurePacket);
    const hasCliClosure = Boolean(task.document.closedByActor || task.document.closedByCommand === 'atm tasks close');
    const hasLegacyBaseline = normalizeOptionalString(task.document.ledgerBaselineKind ?? task.document.ledger_baseline_kind) === 'legacy-transition-backfill'
      && hasTransitionEvent;

    if (closureAuthority === 'target_repo' && targetRepo && !matchesCurrentRepoIdentity(root, targetRepo)) {
      if (!closurePacketRef) {
        findings.push({
          level: 'error',
          code: 'ATM_TASK_AUDIT_CROSS_REPO_DONE_WITHOUT_PACKET',
          path: task.relativePath,
          taskId: task.taskId,
          detail: `Task ${task.taskId} is done in a non-target repo without a target closure packet.`
        });
      }
      continue;
    }

    if (!hasCliClosure && !closurePacketRef && !hasLegacyBaseline) {
      findings.push({
        level: 'error',
        code: 'ATM_TASK_AUDIT_MANUAL_DONE',
        path: task.relativePath,
        taskId: task.taskId,
        detail: `Task ${task.taskId} is marked done without ATM CLI closure metadata.`
      });
    } else if (hasLegacyBaseline && !hasCliClosure && !closurePacketRef) {
      findings.push({
        level: 'warning',
        code: 'ATM_TASK_AUDIT_LEGACY_BASELINE_DONE',
        path: task.relativePath,
        taskId: task.taskId,
        detail: `Task ${task.taskId} is done via a legacy baseline transition; it is traceable but not equivalent to a fresh ATM CLI close.`
      });
    }
  }

  if (taskLedger.enabled && taskLedger.mirrorExternalTasks) {
    for (const externalTask of taskLedger.externalTasks) {
      if (!mirrorKeys.has(externalTaskKey(externalTask.provider, externalTask.taskId))) {
        findings.push({
          level: 'error',
          code: 'ATM_TASK_AUDIT_EXTERNAL_TASK_NOT_MIRRORED',
          path: '.atm/config.json',
          detail: `External task ${externalTask.provider}:${externalTask.taskId} must have a visible ATM mirror task.`
        });
      }
    }
  }

  const latestBulk = inspectLatestCommitForBulkTaskClose(root);
  if (latestBulk.changedDoneTaskFiles.length > 1 && !hasBulkClosureManifest(root)) {
    findings.push({
      level: 'error',
      code: 'ATM_TASK_AUDIT_BULK_CLOSE_WITHOUT_MANIFEST',
      path: latestBulk.commitSha ?? 'HEAD',
      detail: `Latest commit closes ${latestBulk.changedDoneTaskFiles.length} task files without a bulk closure manifest.`
    });
  }

  for (const reportPath of findMarkdownCompletionReports(root)) {
    findings.push({
      level: 'error',
      code: 'ATM_TASK_AUDIT_COMPLETION_REPORT_UNVERIFIED',
      path: reportPath,
      detail: 'Completion report claims all work is complete; tasks audit requires matching task states, command evidence, and closure packets.'
    });
  }

  for (const evidence of evidenceDocs) {
    if (!hasCommandRunEvidence(evidence.document)) {
      findings.push({
        level: 'warning',
        code: 'ATM_TASK_AUDIT_DRAFT_STATIC_EVIDENCE',
        path: evidence.relativePath,
        detail: 'Static evidence has no commandRuns/exitCode/stdout hash and is treated as draft evidence only.'
      });
    }
  }

  const errorCount = findings.filter((entry) => entry.level === 'error').length;
  return {
    schemaId: 'atm.taskAuditReport',
    specVersion: frameworkModeSpecVersion,
    generatedAt,
    repoIdentity,
    inspectedTaskCount: taskDocs.length,
    inspectedEvidenceCount: evidenceDocs.length,
    findings,
    ok: errorCount === 0
  };
}

export function validateClosurePacket(value: unknown): { ok: boolean; missing: readonly string[] } {
  const packet = value as Partial<ClosurePacket> | null;
  const missing: string[] = [];
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
    return { ok: false, missing: ['object'] };
  }
  if (packet.schemaId !== 'atm.closurePacket.v1') missing.push('schemaId');
  if (packet.closedByCommand !== 'atm tasks close') missing.push('closedByCommand');
  if (!normalizeOptionalString(packet.taskId)) missing.push('taskId');
  if (!normalizeOptionalString(packet.closedByActor)) missing.push('closedByActor');
  if (!normalizeOptionalString(packet.evidencePath)) missing.push('evidencePath');
  if (!packet.targetRepoIdentity?.isFrameworkRepo) missing.push('targetRepoIdentity');
  if (!Array.isArray(packet.commandRuns) || packet.commandRuns.length === 0) {
    missing.push('commandRuns');
  } else {
    for (const [index, run] of packet.commandRuns.entries()) {
      if (typeof run.command !== 'string' || run.command.trim().length === 0) missing.push(`commandRuns/${index}/command`);
      if (typeof run.exitCode !== 'number') missing.push(`commandRuns/${index}/exitCode`);
      if (!/^sha256:[a-f0-9]{64}$/.test(String(run.stdoutSha256 ?? ''))) missing.push(`commandRuns/${index}/stdoutSha256`);
      if (!/^sha256:[a-f0-9]{64}$/.test(String(run.stderrSha256 ?? ''))) missing.push(`commandRuns/${index}/stderrSha256`);
    }
  }
  return { ok: missing.length === 0, missing };
}

export function createClosurePacket(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly evidencePath: string;
  readonly requiredGates?: readonly string[];
}): ClosurePacket {
  const cwd = path.resolve(input.cwd);
  const gitDetails = readGitHeadDetails(cwd);
  return {
    schemaId: 'atm.closurePacket.v1',
    specVersion: frameworkModeSpecVersion,
    taskId: input.taskId,
    targetRepoIdentity: detectFrameworkRepoIdentity(cwd),
    targetCommit: gitDetails.commitSha,
    governedTreeSha: gitDetails.treeSha,
    closedByCommand: 'atm tasks close',
    commandRuns: [
      {
        command: 'node atm.mjs tasks close',
        cwd: relativePathFrom(cwd, cwd) || '.',
        exitCode: 0,
        stdoutSha256: sha256('atm tasks close pending result envelope'),
        stderrSha256: sha256(''),
        runnerVersion: readFrameworkVersion(cwd)
      }
    ],
    requiredGates: input.requiredGates ?? defaultRequiredGates,
    evidencePath: input.evidencePath,
    closedAt: new Date().toISOString(),
    closedByActor: input.actorId
  };
}

export function writeClosurePacket(cwd: string, taskId: string, packet: ClosurePacket) {
  const packetPath = path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.closure-packet.json`);
  mkdirSync(path.dirname(packetPath), { recursive: true });
  writeFileSync(packetPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  return relativePathFrom(cwd, packetPath);
}

export function requireTargetRepoClosureAuthority(input: {
  readonly cwd: string;
  readonly taskDocument: Record<string, unknown>;
  readonly taskId: string;
  readonly status: string;
}) {
  if (input.status !== 'done') return null;
  const closureAuthority = normalizeClosureAuthority(input.taskDocument.closure_authority ?? input.taskDocument.closureAuthority);
  const targetRepo = normalizeOptionalString(input.taskDocument.target_repo ?? input.taskDocument.targetRepo ?? input.taskDocument.upstream_repo ?? input.taskDocument.upstreamRepo);
  if (closureAuthority !== 'target_repo' || !targetRepo) return null;
  if (matchesCurrentRepoIdentity(input.cwd, targetRepo)) return null;
  throw new CliError('ATM_TASK_CLOSE_TARGET_REPO_REQUIRED', `Task ${input.taskId} must be closed by its target repo, not the planning repo.`, {
    details: {
      taskId: input.taskId,
      targetRepo,
      closureAuthority
    }
  });
}

function parseFrameworkModeArgs(argv: string[]): ParsedFrameworkModeArgs {
  const state = {
    cwd: process.cwd(),
    action: null as 'status' | null,
    files: [] as string[],
    targetRepo: null as string | null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      state.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--files') {
      state.files = requireValue(argv, index, '--files').split(',').map((entry) => normalizeRelativePath(entry)).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--target-repo') {
      state.targetRepo = requireValue(argv, index, '--target-repo');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `framework-mode does not support option ${arg}`, { exitCode: 2 });
    }
    if (state.action) {
      throw new CliError('ATM_CLI_USAGE', 'framework-mode accepts only one action.', { exitCode: 2 });
    }
    if (arg !== 'status') {
      throw new CliError('ATM_CLI_USAGE', 'framework-mode supports only: status.', { exitCode: 2 });
    }
    state.action = arg;
  }
  if (!state.action) {
    throw new CliError('ATM_CLI_USAGE', 'framework-mode requires an action: status.', { exitCode: 2 });
  }
  return {
    cwd: path.resolve(state.cwd),
    action: state.action,
    files: state.files,
    targetRepo: state.targetRepo
  };
}

function readChangedFiles(cwd: string): readonly string[] {
  const changed = [
    ...runGitLines(cwd, ['diff', '--name-only']),
    ...runGitLines(cwd, ['diff', '--cached', '--name-only']),
    ...runGitLines(cwd, ['ls-files', '--others', '--exclude-standard'])
  ];
  return uniqueSorted(changed.map(normalizeRelativePath).filter(Boolean));
}

function runGitLines(cwd: string, args: readonly string[]): readonly string[] {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) return [];
  return String(result.stdout || '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

function readActiveLockPaths(cwd: string): readonly string[] {
  const lockDir = path.join(cwd, '.atm', 'runtime', 'locks');
  if (!existsSync(lockDir)) return [];
  return readdirSync(lockDir)
    .filter((entry) => entry.endsWith('.lock.json'))
    .map((entry) => normalizeRelativePath(path.join('.atm', 'runtime', 'locks', entry)))
    .sort((left, right) => left.localeCompare(right));
}

function inspectPinnedRunner(cwd: string): PinnedRunnerStatus {
  const metadataPath = path.join(cwd, '.atm', 'runtime', 'pinned-runner.json');
  if (!existsSync(metadataPath)) {
    return {
      status: 'missing',
      metadataPath: relativePathFrom(cwd, metadataPath),
      sourcePath: null,
      runnerPath: null,
      reason: 'pinned runner metadata is missing'
    };
  }
  const metadata = readJsonIfExists(metadataPath) ?? {};
  const sourcePath = normalizeOptionalString(metadata.sourcePath);
  const runnerPath = normalizeOptionalString(metadata.runnerPath);
  const sourceAvailable = sourcePath ? existsSync(path.join(cwd, sourcePath)) : false;
  const runnerAvailable = runnerPath ? existsSync(path.join(cwd, runnerPath)) : false;
  const available = sourceAvailable || runnerAvailable;
  return {
    status: available ? 'available' : 'source-unavailable',
    metadataPath: relativePathFrom(cwd, metadataPath),
    sourcePath,
    runnerPath,
    reason: available ? normalizeOptionalString(metadata.reason) : 'pinned runner source and runner paths are unavailable'
  };
}

function buildRequiredGates(criticalChangedFiles: readonly string[]): readonly string[] {
  const gates = new Set<string>(defaultRequiredGates);
  if (criticalChangedFiles.some((entry) => /^(templates|integrations)\//.test(entry))) {
    gates.add('validate:integration-adapter');
    gates.add('validate:skill-templates');
  }
  if (criticalChangedFiles.some((entry) => /^(release|templates\/root-drop|packages\/cli|scripts\/build-)/.test(entry))) {
    gates.add('validate:root-drop-release');
    gates.add('validate:onefile-release');
  }
  return [...gates];
}

function isDocOnlyPath(relativePath: string): boolean {
  return relativePath === 'README.md'
    || relativePath === 'AGENTS.md'
    || relativePath.endsWith('.md')
    || relativePath.startsWith('docs/')
    || relativePath.startsWith('atomic_workbench/reports/')
    || relativePath.startsWith('atomic_workbench/evidence/');
}

function readTaskDocuments(root: string): ReadonlyArray<{ relativePath: string; taskId: string; status: string; document: Record<string, unknown> }> {
  const taskLedger = readTaskLedgerPolicy(root);
  const jsonTasks = listFiles(path.join(root, taskLedger.taskRoot), (filePath) => filePath.endsWith('.json'))
    .map((absolutePath) => {
      const document = readJsonIfExists(absolutePath) ?? {};
      const taskId = normalizeOptionalString(document.workItemId ?? document.id ?? document.task_id ?? document.taskId) ?? path.basename(absolutePath, '.json');
      return {
        relativePath: relativePathFrom(root, absolutePath),
        taskId,
        status: normalizeStatus(document.status),
        document
      };
    });
  const markdownTasks = listFiles(root, (filePath) => filePath.endsWith('.task.md'))
    .map((absolutePath) => {
      const frontmatter = parseMarkdownFrontmatter(readFileSync(absolutePath, 'utf8'));
      const taskId = normalizeOptionalString(frontmatter.task_id ?? frontmatter.taskId) ?? path.basename(absolutePath).replace(/\.task\.md$/, '');
      return {
        relativePath: relativePathFrom(root, absolutePath),
        taskId,
        status: normalizeStatus(frontmatter.status),
        document: frontmatter
      };
    });
  return [...jsonTasks, ...markdownTasks].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function readEvidenceDocuments(root: string): ReadonlyArray<{ relativePath: string; document: unknown }> {
  const evidenceRoots = [
    path.join(root, 'atomic_workbench', 'evidence'),
    path.join(root, 'atomic_workbench', 'atomization-coverage'),
    path.join(root, 'atomic_workbench', 'graduation-gate')
  ];
  return evidenceRoots.flatMap((evidenceRoot) => listFiles(evidenceRoot, (filePath) => filePath.endsWith('.json'))
    .map((absolutePath) => ({
      relativePath: relativePathFrom(root, absolutePath),
      document: readJsonIfExists(absolutePath)
    })));
}

function inspectLatestCommitForBulkTaskClose(root: string) {
  const commitSha = runGitLines(root, ['rev-parse', '--verify', 'HEAD'])[0] ?? null;
  const changed = runGitLines(root, ['show', '--name-only', '--format=', 'HEAD'])
    .filter((entry) => entry.endsWith('.task.md'));
  const changedDoneTaskFiles = changed.filter((relativePath) => {
    const absolutePath = path.join(root, relativePath);
    if (!existsSync(absolutePath)) return false;
    const frontmatter = parseMarkdownFrontmatter(readFileSync(absolutePath, 'utf8'));
    return normalizeStatus(frontmatter.status) === 'done';
  });
  return { commitSha, changedDoneTaskFiles };
}

function hasBulkClosureManifest(root: string): boolean {
  const candidates = [
    path.join(root, '.atm', 'history', 'evidence'),
    path.join(root, 'atomic_workbench', 'evidence')
  ];
  return candidates.some((candidate) => existsSync(candidate)
    && listFiles(candidate, (filePath) => /bulk.*closure.*\.json$/.test(normalizeRelativePath(filePath))).length > 0);
}

function findMarkdownCompletionReports(root: string): readonly string[] {
  return listFiles(root, (filePath) => filePath.endsWith('.md'))
    .filter((absolutePath) => !absolutePath.includes(`${path.sep}node_modules${path.sep}`))
    .filter((absolutePath) => {
      const text = readFileSync(absolutePath, 'utf8');
      if (text.includes('ATM_GOVERNANCE_AUDIT_SUPERSEDED')) return false;
      return markdownCompletionPatterns.some((pattern) => pattern.test(text));
    })
    .map((absolutePath) => relativePathFrom(root, absolutePath));
}

function hasCommandRunEvidence(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (Array.isArray(candidate.commandRuns)) return candidate.commandRuns.length > 0;
  if (Array.isArray(candidate.commands)) {
    return candidate.commands.some((entry) => entry && typeof entry === 'object' && 'exitCode' in entry);
  }
  if (Array.isArray(candidate.evidence)) {
    return candidate.evidence.some(hasCommandRunEvidence);
  }
  return typeof candidate.command === 'string'
    && ('exitCode' in candidate || 'status' in candidate)
    && ('stdoutSha256' in candidate || 'outputSha256' in candidate);
}

function listFiles(directoryPath: string, predicate: (filePath: string) => boolean): readonly string[] {
  if (!existsSync(directoryPath)) return [];
  const stats = statSync(directoryPath);
  if (stats.isFile()) return predicate(directoryPath) ? [directoryPath] : [];
  const output: string[] = [];
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    if (defaultIgnoredDirs.has(entry.name)) continue;
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      output.push(...listFiles(absolutePath, predicate));
    } else if (entry.isFile() && predicate(absolutePath)) {
      output.push(absolutePath);
    }
  }
  return output;
}

function parseMarkdownFrontmatter(text: string): Record<string, unknown> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, unknown> = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const separatorIndex = rawLine.indexOf(':');
    if (separatorIndex === -1) continue;
    const key = rawLine.slice(0, separatorIndex).trim();
    const value = rawLine.slice(separatorIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

function normalizeClosureAuthority(value: unknown): ClosureAuthority {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
  return normalized === 'target_repo' ? 'target_repo' : normalized === 'local' ? 'local' : 'none';
}

function normalizeStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
}

function matchesCurrentRepoIdentity(root: string, targetRepo: string): boolean {
  const identity = detectFrameworkRepoIdentity(root);
  const target = targetRepo.trim().toLowerCase().replace(/\\/g, '/');
  const rootNormalized = root.replace(/\\/g, '/').toLowerCase();
  const basename = path.basename(root).toLowerCase();
  return target === rootNormalized
    || target === identity.name?.toLowerCase()
    || target === basename
    || target.endsWith(`/${basename}`);
}

function sameRepo(left: string, right: string | null): boolean {
  if (!right) return false;
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function readGitHeadDetails(cwd: string): { commitSha: string | null; treeSha: string | null } {
  const commitSha = runGitLines(cwd, ['rev-parse', '--verify', 'HEAD'])[0] ?? null;
  const treeSha = commitSha ? runGitLines(cwd, ['rev-parse', `${commitSha}^{tree}`])[0] ?? null : null;
  return { commitSha, treeSha };
}

function readJsonIfExists(filePath: string): Record<string, any> | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, any>;
  } catch {
    return null;
  }
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeRelativePath(value: string): string {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `framework development command requires a value for ${flag}`, { exitCode: 2 });
  }
  return value;
}
