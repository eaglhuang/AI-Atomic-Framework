import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { requiredValidationPassesForClosure } from '../framework-development.ts';
import {
  buildProtectedOverrideRepairCandidate,
  recordProtectedOverrideAuditEvent
} from '../emergency/protected-override-audit.ts';
import { readActiveTaskDirectionLocks } from '../task-direction.ts';
import { CliError, makeResult, message, relativePathFrom } from '../shared.ts';
import { createCommitRangeGuardReport } from './commit-range-guard.ts';
import {
  createSanitizedGitEnv,
  normalizeRelativePath,
  runGit,
  runGitScalar
} from './git-index-diagnostics.ts';
export {
  isAncestorCommit,
  isCommitAcceptedByLegacyBaseline,
  readFrameworkCommitRangeBaseline
} from './commit-range-guard.ts';

interface ParsedHookArgs {
  readonly cwd: string;
  readonly action: 'pre-commit' | 'pre-push';
  readonly base: string | null;
  readonly head: string | null;
}

interface PushBaseResolution {
  readonly base: string | null;
  readonly source: 'argument' | 'upstream' | 'head-parent' | 'unresolved';
  readonly upstreamRef: string | null;
  readonly currentBranch: string | null;
}

export interface CommandRunReport {
  readonly command: string;
  readonly cwd: string;
  readonly exitCode: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly stdoutPreview: string;
  readonly stderrPreview: string;
}

interface ValidatorRunTriage {
  readonly blockingRuns: readonly CommandRunReport[];
  readonly advisoryFindings: readonly PreCommitAdvisoryFinding[];
}

export interface PreCommitAdvisoryFinding {
  readonly code: string;
  readonly source: string;
  readonly detail: string;
  readonly file?: string;
  readonly files?: readonly string[];
  readonly scope: 'tree-wide';
  readonly taskId?: string;
  readonly classification?: 'tree-wide-advisory';
  readonly data?: unknown;
}

interface PrePushRefUpdate {
  readonly localRef: string;
  readonly localSha: string;
  readonly remoteRef: string;
  readonly remoteSha: string;
  readonly remoteBranch: string | null;
}

interface PrePushEnforcementDecision {
  readonly targetBranches: readonly string[];
  readonly protectedBranchPatterns: readonly string[];
  readonly hardProtectedBranchTargets: readonly string[];
  readonly hardEnforcement: boolean;
  readonly currentBranch: string | null;
  readonly upstreamRef: string | null;
  readonly baseSource: PushBaseResolution['source'];
  readonly mergeBase: string | null;
  readonly safeModeRequested: boolean;
  readonly safeModeActive: boolean;
  readonly safeModeActor: string | null;
  readonly safeModeReason: string | null;
  readonly safeModeReportPath: string | null;
}

const prePushSafeModeRuntimeDir = ['.atm', 'runtime', 'pre-push-safe-mode'] as const;
const protectedBranchPatterns = ['main', 'master', 'trunk', 'release/*'] as const;

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((entry) => String(entry).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `hook command requires a value for ${flag}`, { exitCode: 2 });
  }
  return value;
}

function isPathAllowedByTaskDirection(filePath: string, allowedFiles: readonly string[]): boolean {
  const normalized = normalizeRelativePath(filePath);
  return allowedFiles.some((allowed) => matchesTaskDirectionPath(normalized, allowed));
}

function matchesTaskDirectionPath(filePath: string, allowedPath: string): boolean {
  const normalizedFile = normalizeRelativePath(filePath);
  const normalizedAllowed = normalizeRelativePath(allowedPath);
  if (normalizedAllowed.endsWith('/**')) {
    const prefix = normalizedAllowed.slice(0, -3);
    return normalizedFile === prefix || normalizedFile.startsWith(`${prefix}/`);
  }
  return normalizedFile === normalizedAllowed;
}

export function runPrePushHook(cwd: string, base: string | null, head: string | null) {
  const root = path.resolve(cwd);
  const resolvedHead = head ?? 'HEAD';
  const pushRefs = readPrePushRefUpdates();
  const baseInfo = resolvePushBase(root, base);
  if (!baseInfo.base) {
    return makeResult({
      ok: true,
      command: 'hook',
      cwd: root,
      messages: [message('warning', 'ATM_HOOK_PRE_PUSH_BASE_UNRESOLVED', 'ATM pre-push hook could not resolve a base ref; commit-range guard was skipped.')],
      evidence: {
        action: 'pre-push',
        base,
        head: resolvedHead,
        pushRefs,
        baseResolution: baseInfo,
        skipped: true
      }
    });
  }
  const report = createCommitRangeGuardReport(root, baseInfo.base, resolvedHead);
  const enforcement = createPrePushEnforcementDecision(root, pushRefs, baseInfo, report.head, report.findings.length > 0);
  const hardFailure = enforcement.hardEnforcement && report.findings.length > 0 && !enforcement.safeModeActive;
  const warnOnly = report.findings.length > 0 && !hardFailure;
  const safeModeMissingMetadata = enforcement.safeModeRequested && report.findings.length > 0 && !enforcement.safeModeActive;
  const evidenceMissingDiagnostic = report.evidenceMissingDiagnostic
    ? [message('info', 'ATM_HOOK_PRE_PUSH_GIT_HEAD_EVIDENCE_MISSING_DIAGNOSTIC', 'ATM pre-push found critical commits without git-head evidence after the accepted baseline. This is diagnostic only; same-commit governed provenance and closeout-boundary evidence remain the strict checks.', report.evidenceMissingDiagnostic)]
    : [];
  return makeResult({
    ok: !hardFailure && !safeModeMissingMetadata,
    command: 'hook',
    cwd: root,
    messages: [
      safeModeMissingMetadata
        ? message('error', 'ATM_HOOK_PRE_PUSH_SAFE_MODE_METADATA_REQUIRED', 'ATM pre-push safe mode requires ATM_ACTOR_ID (or AGENT_IDENTITY) and ATM_FRAMEWORK_PUSH_GUARD_REASON so bypasses stay traceable.', {
          base: baseInfo.base,
          head: resolvedHead,
          targetBranches: enforcement.targetBranches,
          currentBranch: enforcement.currentBranch
        })
        : hardFailure
          ? message('error', 'ATM_HOOK_PRE_PUSH_FAILED', 'ATM pre-push commit-range guard blocked this push.', {
            base: baseInfo.base,
            head: resolvedHead,
            findings: report.findings,
            rangeDecision: enforcement
          })
          : warnOnly
            ? message(
              'warning',
              enforcement.safeModeActive ? 'ATM_HOOK_PRE_PUSH_SAFE_MODE_BYPASS' : 'ATM_HOOK_PRE_PUSH_WARN_ONLY_NON_PROTECTED',
              enforcement.safeModeActive
                ? 'ATM pre-push commit-range guard findings were downgraded by maintainer safe mode for this protected push.'
                : 'ATM pre-push commit-range guard findings were downgraded to warnings because the target is not a protected framework branch.',
              {
                base: baseInfo.base,
                head: resolvedHead,
                findings: report.findings,
                rangeDecision: enforcement
              }
            )
            : message('info', 'ATM_HOOK_PRE_PUSH_OK', 'ATM pre-push commit-range guard passed.', {
              base: baseInfo.base,
              head: resolvedHead,
              criticalCommitCount: report.criticalCommits.length,
              rangeDecision: enforcement
            }),
      ...evidenceMissingDiagnostic
    ],
    evidence: {
      action: 'pre-push',
      pushRefs,
      baseResolution: baseInfo,
      enforcement,
      report
    }
  });
}
function createPrePushEnforcementDecision(
  cwd: string,
  pushRefs: readonly PrePushRefUpdate[],
  baseInfo: PushBaseResolution,
  headRef: string,
  hasBlockingFindings: boolean
): PrePushEnforcementDecision {
  const pushedBranches = uniqueSorted(pushRefs.map((entry) => entry.remoteBranch).filter((entry): entry is string => Boolean(entry)));
  const targetBranches = pushedBranches.length > 0
    ? pushedBranches
    : uniqueSorted([
      ...deriveBranchesFromRef(baseInfo.upstreamRef),
      ...deriveBranchesFromRef(baseInfo.currentBranch)
    ]);
  const hardProtectedBranchTargets = targetBranches.filter(isProtectedFrameworkBranchTarget);
  const hardEnforcement = hardProtectedBranchTargets.length > 0;
  const safeModeRequested = isTruthyEnv(process.env.ATM_FRAMEWORK_PUSH_GUARD_SAFE_MODE);
  const safeModeActor = normalizeOptionalText(process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY);
  const safeModeReason = normalizeOptionalText(process.env.ATM_FRAMEWORK_PUSH_GUARD_REASON);
  const safeModeActive = safeModeRequested
    && hardEnforcement
    && hasBlockingFindings
    && Boolean(safeModeActor)
    && Boolean(safeModeReason);
  const safeModeReportPath = safeModeActive
    ? writePrePushSafeModeReport(cwd, {
      targetBranches,
      hardProtectedBranchTargets,
      currentBranch: baseInfo.currentBranch,
      upstreamRef: baseInfo.upstreamRef,
      base: baseInfo.base,
      head: headRef,
      actorId: safeModeActor!,
      reason: safeModeReason!,
      pushRefs
    })
    : null;
  return {
    targetBranches,
    protectedBranchPatterns: [...protectedBranchPatterns],
    hardProtectedBranchTargets,
    hardEnforcement,
    currentBranch: baseInfo.currentBranch,
    upstreamRef: baseInfo.upstreamRef,
    baseSource: baseInfo.source,
    mergeBase: baseInfo.base ? runGitScalar(cwd, ['merge-base', baseInfo.base, headRef]) : null,
    safeModeRequested,
    safeModeActive,
    safeModeActor,
    safeModeReason,
    safeModeReportPath
  };
}
export function runRequiredFrameworkValidators(cwd: string, requiredGates: readonly string[]): readonly CommandRunReport[] {
  const validationPasses = requiredValidationPassesForClosure(requiredGates);
  if (validationPasses.length === 0) return [];
  const commands = uniqueSorted(validationPasses.map((gate) => gate === 'typecheck' ? 'npm run typecheck' : `npm run ${gate}`));
  return commands.map((command) => runShellCommandForReport(cwd, command));
}

export function triageForeignTaskflowValidatorRuns(input: {
  cwd: string;
  stagedFiles: readonly string[];
  activeDirectionLocks: ReturnType<typeof readActiveTaskDirectionLocks>;
  failedRuns: readonly CommandRunReport[];
}): ValidatorRunTriage {
  const taskflowPath = 'packages/cli/src/commands/taskflow.ts';
  if (input.failedRuns.length === 0) {
    return { blockingRuns: input.failedRuns, advisoryFindings: [] };
  }
  if (input.stagedFiles.includes(taskflowPath)) {
    return { blockingRuns: input.failedRuns, advisoryFindings: [] };
  }
  const owningLocks = input.activeDirectionLocks.filter((lock) => isPathAllowedByTaskDirection(taskflowPath, lock.allowedFiles));
  if (owningLocks.length === 0) {
    return { blockingRuns: input.failedRuns, advisoryFindings: [] };
  }

  const blockingRuns: CommandRunReport[] = [];
  const advisoryFindings: PreCommitAdvisoryFinding[] = [];
  for (const run of input.failedRuns) {
    const preview = `${run.stdoutPreview}\n${run.stderrPreview}`;
    const mentionsForeignTaskflow = preview.includes(taskflowPath)
      || preview.includes('buildTaskflowCloseWriteReadinessHint')
      || preview.includes('Identifier \'buildTaskflowCloseWriteReadinessHint\' has already been declared')
      || preview.includes('Cannot find name \'Taskflow')
      || preview.includes('Cannot find name \'buildHistoricalClosePreflight\'');
    const isFrameworkSurface = run.command === 'npm run typecheck' || run.command === 'npm run validate:cli';
    if (isFrameworkSurface && mentionsForeignTaskflow) {
      advisoryFindings.push({
        code: 'ATM_HOOK_FOREIGN_TASKFLOW_WIP_ADVISORY',
        source: 'framework-validator',
        detail: `${run.command} failed against foreign in-flight taskflow.ts source owned by active direction lock(s): ${owningLocks.map((lock) => lock.taskId).join(', ')}. This commit does not stage taskflow.ts, so the failure is advisory for this lane.`,
        scope: 'tree-wide',
        classification: 'tree-wide-advisory',
        data: {
          command: run.command,
          foreignTaskflowPath: taskflowPath,
          owningTaskIds: owningLocks.map((lock) => lock.taskId),
          stdoutSha256: run.stdoutSha256,
          stderrSha256: run.stderrSha256
        }
      });
      continue;
    }
    blockingRuns.push(run);
  }
  return { blockingRuns, advisoryFindings };
}

export function runCommandForReport(cwd: string, command: string, args: readonly string[]): CommandRunReport {
  const result = spawnSync(command, [...args], { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  const stdout = String(result.stdout ?? '');
  const stderr = [String(result.stderr ?? ''), result.error?.message ?? ''].filter(Boolean).join('\n');
  return {
    command: [command, ...args].join(' '),
    cwd,
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    stdoutPreview: stdout.slice(-2000),
    stderrPreview: stderr.slice(-2000)
  };
}

function createSanitizedValidatorEnv(): NodeJS.ProcessEnv {
  return createSanitizedGitEnv();
}

export function runShellCommandForReport(cwd: string, commandLine: string): CommandRunReport {
  const env = createSanitizedValidatorEnv();
  const result = spawnSync(commandLine, {
    cwd,
    encoding: 'utf8',
    shell: true,
    env
  });
  const stdout = String(result.stdout ?? '');
  const stderr = [String(result.stderr ?? ''), result.error?.message ?? ''].filter(Boolean).join('\n');
  return {
    command: commandLine,
    cwd,
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    stdoutPreview: stdout.slice(-2000),
    stderrPreview: stderr.slice(-2000)
  };
}
export function resolvePushBase(cwd: string, explicitBase: string | null): PushBaseResolution {
  const currentBranch = runGitScalar(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const upstreamRef = runGitScalar(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (explicitBase) {
    return {
      base: explicitBase,
      source: 'argument',
      upstreamRef,
      currentBranch
    };
  }
  if (upstreamRef) {
    return {
      base: upstreamRef,
      source: 'upstream',
      upstreamRef,
      currentBranch
    };
  }
  const parent = runGitScalar(cwd, ['rev-parse', '--verify', 'HEAD~1']);
  if (parent) {
    return {
      base: parent,
      source: 'head-parent',
      upstreamRef,
      currentBranch
    };
  }
  return {
    base: null,
    source: 'unresolved',
    upstreamRef,
    currentBranch
  };
}
export function readPrePushRefUpdates(): readonly PrePushRefUpdate[] {
  if (process.stdin.isTTY) return [];
  try {
    const input = readFileSync(0, 'utf8');
    return String(input ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [localRef = '', localSha = '', remoteRef = '', remoteSha = ''] = line.split(/\s+/);
        return {
          localRef,
          localSha,
          remoteRef,
          remoteSha,
          remoteBranch: normalizeRemoteBranch(remoteRef)
        };
      })
      .filter((entry) => entry.remoteRef.length > 0);
  } catch {
    return [];
  }
}
export function parseHookArgs(argv: string[]): ParsedHookArgs {
  const state = {
    cwd: process.cwd(),
    action: null as ParsedHookArgs['action'] | null,
    base: null as string | null,
    head: null as string | null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      state.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--base') {
      state.base = requireValue(argv, index, '--base');
      index += 1;
      continue;
    }
    if (arg === '--head') {
      state.head = requireValue(argv, index, '--head');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') continue;
    if (arg !== 'pre-commit' && arg !== 'pre-push') {
      throw new CliError('ATM_CLI_USAGE', 'hook supports only: pre-commit, pre-push', { exitCode: 2 });
    }
    state.action = arg;
  }
  if (!state.action) {
    throw new CliError('ATM_CLI_USAGE', 'hook requires an action: pre-commit | pre-push', { exitCode: 2 });
  }
  return {
    cwd: path.resolve(state.cwd),
    action: state.action,
    base: state.base,
    head: state.head
  };
}
function deriveBranchesFromRef(ref: string | null): readonly string[] {
  const normalized = normalizeRemoteBranch(ref);
  return normalized ? [normalized] : [];
}

function normalizeRemoteBranch(ref: string | null): string | null {
  const normalized = normalizeOptionalText(ref)?.replace(/\\/g, '/');
  if (!normalized) return null;
  if (normalized.startsWith('refs/heads/')) {
    return normalized.slice('refs/heads/'.length);
  }
  if (normalized.startsWith('refs/remotes/')) {
    const parts = normalized.slice('refs/remotes/'.length).split('/');
    return parts.length > 1 ? parts.slice(1).join('/') : (parts[0] ?? null);
  }
  if (normalized.startsWith('origin/')) {
    return normalized.slice('origin/'.length);
  }
  return normalized;
}

function isProtectedFrameworkBranchTarget(branch: string): boolean {
  const normalized = normalizeOptionalText(branch)?.replace(/\\/g, '/');
  if (!normalized) return false;
  return normalized === 'main'
    || normalized === 'master'
    || normalized === 'trunk'
    || normalized.startsWith('release/');
}

function isTruthyEnv(value: unknown): boolean {
  const normalized = normalizeOptionalText(value);
  return normalized === '1' || normalized?.toLowerCase() === 'true';
}

function writePrePushSafeModeReport(cwd: string, input: {
  readonly targetBranches: readonly string[];
  readonly hardProtectedBranchTargets: readonly string[];
  readonly currentBranch: string | null;
  readonly upstreamRef: string | null;
  readonly base: string | null;
  readonly head: string;
  readonly actorId: string;
  readonly reason: string;
  readonly pushRefs: readonly PrePushRefUpdate[];
}): string {
  const root = path.resolve(cwd);
  const runtimeDir = path.join(root, ...prePushSafeModeRuntimeDir);
  mkdirSync(runtimeDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const absolutePath = path.join(runtimeDir, `${stamp}.json`);
  const payload = {
    schemaId: 'atm.prePushSafeModeReport.v1',
    generatedAt: new Date().toISOString(),
    actorId: input.actorId,
    reason: input.reason,
    currentBranch: input.currentBranch,
    upstreamRef: input.upstreamRef,
    base: input.base,
    head: input.head,
    targetBranches: input.targetBranches,
    hardProtectedBranchTargets: input.hardProtectedBranchTargets,
    pushRefs: input.pushRefs
  };
  writeFileSync(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  recordProtectedOverrideAuditEvent({
    cwd: root,
    actorId: input.actorId,
    taskId: null,
    surface: 'hook pre-push safe-mode',
    command: 'node atm.mjs hook pre-push --json',
    flags: ['ATM_FRAMEWORK_PUSH_GUARD_SAFE_MODE'],
    permission: null,
    leaseId: null,
    reason: input.reason,
    skippedChecks: ['pre-push-commit-range-guard', 'git-head-evidence-range-check'],
    touchedFiles: [relativePathFrom(root, absolutePath)],
    outcome: 'authorized',
    repairCandidate: buildProtectedOverrideRepairCandidate({
      summary: 'Pre-push safe mode bypassed protected branch guard; rerun pre-push without safe mode after fixing findings.',
      suggestedCommand: 'node atm.mjs hook pre-push --base <base> --head HEAD --json',
      deferredChecks: ['pre-push-commit-range-guard', 'git-head-evidence-range-check']
    })
  });
  return relativePathFrom(root, absolutePath);
}
