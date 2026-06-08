import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditTasks, buildFrameworkTempClaimCommand, buildFrameworkStaleCleanupCommand, createFrameworkModeStatus, detectFrameworkRepoIdentity, isFrameworkStaleLockReleasable, isAdopterInfrastructureSyncCommit, isAtmCriticalNonDocSurface, requiredValidationPassesForClosure, validateClosurePacket } from './framework-development.js';
import { findActorByResolvedId, readRuntimeIdentityDefault } from './actor-registry.js';
import { resolveActorWorkSession } from './actor-session.js';
import { gitHeadEvidencePath, gitHeadEvidencePaths } from './git-head-evidence.js';
import { CliError, makeResult, message, quoteCliValue, readFrameworkVersion, relativePathFrom } from './shared.js';
import { diagnoseTaskDirectionLockAllowedFiles, isPlanningMirrorPath, isTaskDirectionPathCandidate, readActiveTaskDirectionLocks } from './task-direction.js';
import { isPathAllowedByScope, listActiveBatchRuns, readActiveQuickfixLock } from './work-channels.js';
import { runContextMapAdvisor } from './hook/context-map-advisor.js';
export const hookContractVersion = 'atm.integration-hooks/v1';
export const hookProvider = 'atm-framework-development-hooks/v1';
export const hookMarker = 'ATM_INTEGRATION_HOOK_CONTRACT_V1';
const textFileExtensions = new Set([
    '.cjs',
    '.css',
    '.html',
    '.js',
    '.json',
    '.jsx',
    '.md',
    '.mjs',
    '.ps1',
    '.sh',
    '.ts',
    '.tsx',
    '.txt',
    '.yaml',
    '.yml'
]);
const hookFileNames = ['pre-commit', 'pre-push'];
const frameworkCommitRangeBaselineRelativePath = '.atm/history/baselines/framework-commit-range.json';
const prePushSafeModeRuntimeDir = ['.atm', 'runtime', 'pre-push-safe-mode'];
const protectedBranchPatterns = ['main', 'master', 'trunk', 'release/*'];
export function runHook(argv) {
    const options = parseHookArgs(argv);
    if (options.action === 'pre-commit') {
        return runPreCommitHook(options.cwd);
    }
    return runPrePushHook(options.cwd, options.base, options.head);
}
export function runGitHooks(argv) {
    const options = parseGitHooksArgs(argv);
    if (options.action === 'install') {
        const installReport = installGitHooks(options.cwd, { frameworkRequired: options.frameworkRequired });
        return makeResult({
            ok: installReport.ok,
            command: 'git-hooks',
            cwd: options.cwd,
            messages: [
                installReport.ok
                    ? message('info', 'ATM_GIT_HOOKS_INSTALLED', 'ATM Git hooks are installed and configured.', installReport)
                    : message('error', 'ATM_GIT_HOOKS_INSTALL_FAILED', 'ATM Git hooks could not be fully installed.', installReport)
            ],
            evidence: {
                action: 'install',
                report: installReport
            }
        });
    }
    const verifyReport = inspectGitHooks(options.cwd, { frameworkRequired: options.frameworkRequired });
    return makeResult({
        ok: verifyReport.ok,
        command: 'git-hooks',
        cwd: options.cwd,
        messages: [
            verifyReport.ok
                ? message('info', 'ATM_GIT_HOOKS_VERIFY_OK', 'ATM Git hook installation is healthy.', verifyReport)
                : message('error', 'ATM_GIT_HOOKS_VERIFY_FAILED', 'ATM Git hook installation is missing or drifted.', verifyReport)
        ],
        evidence: {
            action: 'verify',
            report: verifyReport
        }
    });
}
export function runCommitRangeGuard(argv) {
    const options = parseCommitRangeArgs(argv);
    const report = createCommitRangeGuardReport(options.cwd, options.base, options.head);
    return makeResult({
        ok: report.ok,
        command: 'guard',
        cwd: options.cwd,
        messages: [
            report.ok
                ? message('info', 'ATM_GUARD_COMMIT_RANGE_OK', 'Commit range guard passed.', {
                    base: options.base,
                    head: options.head,
                    criticalCommitCount: report.criticalCommits.length
                })
                : message('error', 'ATM_GUARD_COMMIT_RANGE_FAILED', 'Commit range guard found commits that bypassed ATM evidence or task closure gates.', {
                    base: options.base,
                    head: options.head,
                    findings: report.findings
                })
        ],
        evidence: {
            guard: 'commit-range',
            report
        }
    });
}
export function inspectGitHooks(cwd, options = {}) {
    const root = path.resolve(cwd);
    const repoIdentity = detectFrameworkRepoIdentity(root);
    const required = options.frameworkRequired === true || repoIdentity.isFrameworkRepo;
    const hooksPath = runGitScalar(root, ['config', '--get', 'core.hooksPath']);
    const expectedHooksPath = '.atm/git-hooks';
    const installedHookFiles = hookFileNames.map((hookName) => inspectHookFile(root, hookName));
    const hooksPathOk = normalizeGitConfigPath(hooksPath) === expectedHooksPath;
    const filesOk = installedHookFiles.every((entry) => entry.present && entry.markerPresent);
    return {
        schemaId: 'atm.gitHooksInspection.v1',
        generatedAt: new Date().toISOString(),
        repoIdentity,
        required,
        hooksPath,
        expectedHooksPath,
        hooksPathOk,
        installedHookFiles,
        ok: required ? hooksPathOk && filesOk : true
    };
}
export function installGitHooks(cwd, options = {}) {
    const root = path.resolve(cwd);
    const repoIdentity = detectFrameworkRepoIdentity(root);
    const required = options.frameworkRequired === true || repoIdentity.isFrameworkRepo;
    const hooksDir = path.join(root, '.atm', 'git-hooks');
    mkdirSync(hooksDir, { recursive: true });
    const writtenFiles = hookFileNames.map((hookName) => {
        const hookPath = path.join(hooksDir, hookName);
        writeFileSync(hookPath, createGitHookScript(hookName), 'utf8');
        try {
            chmodSync(hookPath, 0o755);
        }
        catch {
            // chmod is best-effort on Windows filesystems.
        }
        return relativePathFrom(root, hookPath);
    });
    const configResult = runGit(root, ['config', 'core.hooksPath', '.atm/git-hooks']);
    const inspection = inspectGitHooks(root, { frameworkRequired: required });
    return {
        schemaId: 'atm.gitHooksInstallReport.v1',
        generatedAt: new Date().toISOString(),
        repoIdentity,
        required,
        writtenFiles,
        gitConfigExitCode: configResult.exitCode,
        gitConfigStderr: configResult.stderr.trim(),
        ok: inspection.ok && configResult.exitCode === 0,
        inspection
    };
}
function runPreCommitHook(cwd) {
    const root = path.resolve(cwd);
    const stagedFiles = readStagedFiles(root).filter((entry) => entry !== gitHeadEvidencePaths.legacyJson && entry !== gitHeadEvidencePaths.jsonl);
    const gitIndexDiagnostic = inspectGitIndexAccess(root);
    const encodingReport = scanEncoding(root, stagedFiles);
    const frameworkStatus = createFrameworkModeStatus({ cwd: root, files: stagedFiles });
    const allowAdopterInfrastructureSync = isAdopterInfrastructureSyncCommit(stagedFiles.length > 0 ? stagedFiles : frameworkStatus.changedFiles);
    const activeDirectionLocks = readActiveTaskDirectionLocks(root);
    const activeQuickfixLock = readActiveQuickfixLock(root);
    const directionLockAllowedFiles = uniqueSorted(activeDirectionLocks.flatMap((lock) => lock.allowedFiles));
    const directionLockAllowedFilesDiagnoses = activeDirectionLocks
        .map((lock) => diagnoseTaskDirectionLockAllowedFiles(root, lock.taskId));
    const directionLockAllowedFilesMismatches = directionLockAllowedFilesDiagnoses.filter((entry) => entry.mismatches.length > 0);
    const checkpointClosedTaskAllowedFiles = collectStagedBatchCheckpointScopeFiles(root, stagedFiles);
    const checkpointCoversFrameworkCriticalFiles = frameworkStatus.criticalChangedFiles.length > 0
        && frameworkStatus.criticalChangedFiles.every((entry) => isPathAllowedByTaskDirection(entry, checkpointClosedTaskAllowedFiles));
    const blockingFrameworkIssues = frameworkStatus.blockers.filter((entry) => {
        if (entry === 'git-head-evidence-missing')
            return false;
        if (entry === 'active-framework-claim-required' && checkpointCoversFrameworkCriticalFiles)
            return false;
        if (entry === 'closure-authority-belongs-to-target-repo' && allowAdopterInfrastructureSync)
            return false;
        return true;
    });
    const frameworkTempClaimAllowedFiles = activeDirectionLocks.length > 0
        ? collectFrameworkTempClaimAllowedFiles(root)
        : [];
    const directionLockPlanningMirrorPaths = uniqueSorted(activeDirectionLocks.flatMap((lock) => lock.planningMirrorPaths ?? []));
    const directionLockAllowsPlanningMirror = activeDirectionLocks.some((lock) => lock.allowPlanningMirror === true);
    const directionLockDriftFiles = activeDirectionLocks.length > 0 && !allowAdopterInfrastructureSync
        ? stagedFiles
            .filter((entry) => !isTaskDirectionPreCommitExempt(entry))
            .filter((entry) => !isPathAllowedByTaskDirection(entry, directionLockAllowedFiles))
            .filter((entry) => !isPathAllowedByTaskDirection(entry, checkpointClosedTaskAllowedFiles))
            .filter((entry) => !isPathAllowedByTaskDirection(entry, frameworkTempClaimAllowedFiles))
        : [];
    const planningMirrorDriftFiles = activeDirectionLocks.length > 0 && !allowAdopterInfrastructureSync && directionLockPlanningMirrorPaths.length > 0 && !directionLockAllowsPlanningMirror
        ? stagedFiles
            .filter((entry) => !isTaskDirectionPreCommitExempt(entry))
            .filter((entry) => isPlanningMirrorPath(entry, directionLockPlanningMirrorPaths))
        : [];
    const quickfixDriftFiles = activeQuickfixLock && !allowAdopterInfrastructureSync
        ? stagedFiles
            .filter((entry) => !isTaskDirectionPreCommitExempt(entry))
            .filter((entry) => !isPathAllowedByScope(entry, activeQuickfixLock.allowedFiles))
        : [];
    const quickfixFileLimitExceeded = activeQuickfixLock
        ? stagedFiles.filter((entry) => !entry.startsWith('.atm/')).length > activeQuickfixLock.maxFiles
        : false;
    const quickfixChangedLineCount = activeQuickfixLock
        ? readStagedChangedLineCount(root, stagedFiles.filter((entry) => !entry.startsWith('.atm/')))
        : 0;
    const quickfixLineLimitExceeded = activeQuickfixLock
        ? quickfixChangedLineCount > activeQuickfixLock.maxChangedLines
        : false;
    const protectedStateReport = inspectProtectedAtmStateChanges(root, stagedFiles);
    const taskCardStatusReport = inspectTaskCardStatusChanges(root, stagedFiles);
    const commitAttributionReport = inspectCommitAttribution(root, stagedFiles);
    const taskAudit = auditTasks(root);
    const commandRuns = frameworkStatus.criticalChangedFiles.length > 0
        ? runRequiredFrameworkValidators(root, frameworkStatus.requiredGates)
        : [];
    const failedValidatorRuns = commandRuns.filter((entry) => entry.exitCode !== 0);
    const staleLocks = frameworkStatus.staleLocks;
    const releasableStaleLock = staleLocks.find(isFrameworkStaleLockReleasable) ?? null;
    const baseClaimCommand = buildFrameworkTempClaimCommand(frameworkStatus.criticalChangedFiles, 'temporary framework maintenance before commit', releasableStaleLock?.actorId ?? null);
    const frameworkClaimCommand = blockingFrameworkIssues.includes('active-framework-claim-required')
        ? baseClaimCommand
        : blockingFrameworkIssues.includes('framework-stale-lock-cleanup-required') && releasableStaleLock
            ? buildFrameworkStaleCleanupCommand(releasableStaleLock, frameworkStatus.criticalChangedFiles, 'temporary framework maintenance before commit')
            : null;
    const ok = encodingReport.ok
        && gitIndexDiagnostic.ok
        && blockingFrameworkIssues.length === 0
        && planningMirrorDriftFiles.length === 0
        && directionLockDriftFiles.length === 0
        && quickfixDriftFiles.length === 0
        && !quickfixFileLimitExceeded
        && !quickfixLineLimitExceeded
        && commitAttributionReport.ok
        && protectedStateReport.ok
        && taskCardStatusReport.ok
        && taskAudit.ok
        && failedValidatorRuns.length === 0;
    const evidenceWrite = ok && stagedFiles.length > 0
        ? writeStagedGitHeadEvidence(root, stagedFiles, commandRuns)
        : null;
    const blockingFindings = buildPreCommitBlockingFindings({
        encodingReport,
        gitIndexDiagnostic,
        blockingFrameworkIssues,
        frameworkClaimCommand,
        staleLocks,
        planningMirrorDriftFiles,
        directionLockDriftFiles,
        quickfixDriftFiles,
        quickfixFileLimitExceeded,
        quickfixLineLimitExceeded,
        quickfixChangedLineCount,
        commitAttributionFindings: commitAttributionReport.findings,
        protectedStateFindings: protectedStateReport.findings,
        taskCardStatusFindings: taskCardStatusReport.findings,
        taskAuditFindings: taskAudit.findings,
        failedValidatorRuns
    });
    const failureEnvelope = ok
        ? null
        : buildPreCommitFailureEnvelope({
            blockingFindings,
            frameworkClaimCommand,
            gitIndexDiagnostic,
            failedValidatorRuns
        });
    const directionLockAllowedFilesWarning = directionLockAllowedFilesMismatches.length > 0
        ? message('warn', 'ATM_DIRECTION_LOCK_ALLOWED_FILES_MISMATCH', 'Active task direction lock(s) have drifted between top-level files, embedded allowedFiles, or claim.files. Canonical source is taskDirectionLock.allowedFiles.', {
            diagnoses: directionLockAllowedFilesMismatches
        })
        : null;
    try {
        runContextMapAdvisor(root);
    }
    catch {
        // ignore
    }
    return makeResult({
        ok,
        command: 'hook',
        cwd: root,
        messages: [
            ok
                ? message('info', 'ATM_HOOK_PRE_COMMIT_OK', 'ATM pre-commit hook passed and staged git-head evidence when needed.', {
                    stagedFileCount: stagedFiles.length,
                    criticalChangedFileCount: frameworkStatus.criticalChangedFiles.length,
                    evidencePath: evidenceWrite?.evidencePath ?? null
                })
                : message('error', 'ATM_HOOK_PRE_COMMIT_FAILED', 'ATM pre-commit hook blocked this commit.', {
                    encodingFindings: encodingReport.findings.length,
                    frameworkBlockers: blockingFrameworkIssues,
                    planningMirrorDriftFiles,
                    taskDirectionDriftFiles: directionLockDriftFiles,
                    quickfixDriftFiles,
                    quickfixFileLimitExceeded,
                    quickfixLineLimitExceeded,
                    quickfixChangedLineCount,
                    protectedStateFindings: protectedStateReport.findings,
                    taskCardStatusFindings: taskCardStatusReport.findings,
                    taskAuditFindings: taskAudit.findings.length,
                    failedValidators: failedValidatorRuns.map((entry) => entry.command),
                    gitIndexDiagnostic,
                    blockingFindings,
                    failureEnvelope,
                    nextStep: blockingFindings.find((entry) => entry.requiredCommand)?.requiredCommand ?? frameworkClaimCommand
                }),
            ...(directionLockAllowedFilesWarning ? [directionLockAllowedFilesWarning] : [])
        ],
        evidence: {
            action: 'pre-commit',
            stagedFiles,
            gitIndexDiagnostic,
            encodingReport,
            frameworkStatus,
            allowAdopterInfrastructureSync,
            blockingFrameworkIssues,
            frameworkClaimCommand,
            activeDirectionLocks,
            directionLockPlanningMirrorPaths,
            directionLockAllowedFilesDiagnoses,
            directionLockAllowedFilesMismatches,
            planningMirrorDriftFiles,
            activeQuickfixLock,
            directionLockDriftFiles,
            quickfixDriftFiles,
            quickfixFileLimitExceeded,
            quickfixLineLimitExceeded,
            quickfixChangedLineCount,
            commitAttributionReport,
            protectedStateReport,
            taskCardStatusReport,
            taskAudit,
            commandRuns,
            blockingFindings,
            failureEnvelope,
            evidenceWrite
        }
    });
}
function buildPreCommitBlockingFindings(input) {
    const findings = [];
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
    findings.push(...input.commitAttributionFindings);
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
    for (const finding of input.taskAuditFindings.filter((entry) => entry.level === 'error')) {
        findings.push({
            code: finding.code,
            source: 'task-audit',
            file: 'path' in finding && typeof finding.path === 'string' ? finding.path : undefined,
            detail: finding.detail,
            classification: 'current-task'
        });
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
function buildPreCommitFailureEnvelope(input) {
    const requiredCommand = input.blockingFindings.find((entry) => entry.requiredCommand)?.requiredCommand
        ?? input.frameworkClaimCommand
        ?? null;
    const baselineFailures = input.blockingFindings.filter(isPreCommitBaselineFinding);
    const currentTaskFailures = input.blockingFindings.filter((finding) => !isPreCommitBaselineFinding(finding) && !isPreCommitEnvironmentFinding(finding));
    return {
        schemaId: 'atm.validatorFailureEnvelope.v1',
        ok: false,
        surface: 'pre-commit',
        requiredCommand,
        blockingFindings: input.blockingFindings,
        baselineFailures,
        currentTaskFailures,
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
function buildPreCommitRepairHints(findings, requiredCommand) {
    if (findings.length === 0) {
        return requiredCommand ? [`Run required command: ${requiredCommand}`] : [];
    }
    return findings.map((finding) => {
        if (finding.code === 'ATM_ENV_SANDBOX_GIT_EPERM') {
            return 'Rerun the commit with repository-level Git permissions, or set ATM_TEMP_ROOT=C:\\tmp for validators that create temporary Git repositories.';
        }
        if (finding.code === 'ATM_GIT_INDEX_PERMISSION_DENIED') {
            return 'Resolve the local Git/index permission problem outside ATM, then retry the commit. This is an environment diagnostic, not task evidence.';
        }
        if (finding.requiredCommand) {
            return `Run required command: ${finding.requiredCommand}`;
        }
        return `Resolve ${finding.source} finding ${finding.code}, then retry the commit.`;
    });
}
function isPreCommitBaselineFinding(finding) {
    return finding.classification === 'baseline' || finding.source === 'baseline';
}
function isPreCommitEnvironmentFinding(finding) {
    return finding.classification === 'environment'
        || finding.source === 'environment'
        || finding.source === 'git-index'
        || finding.code.startsWith('ATM_ENV_')
        || finding.code.startsWith('ATM_GIT_INDEX_');
}
function inspectGitIndexAccess(cwd) {
    const indexLockPath = path.join(cwd, '.git', 'index.lock');
    const status = runGit(cwd, ['status', '--short']);
    const stderr = status.stderr.trim();
    const environmentFailure = classifySandboxGitFailure(stderr);
    const gitIndexPermissionFailure = classifyGitIndexPermissionFailure(stderr);
    const detail = status.exitCode === 0
        ? 'Git index is readable by ATM pre-commit diagnostics.'
        : classifyGitIndexFailure(stderr || `git status exited with ${status.exitCode}`);
    return {
        schemaId: 'atm.gitIndexDiagnostic.v1',
        ok: status.exitCode === 0,
        code: status.exitCode === 0
            ? 'ATM_GIT_INDEX_OK'
            : environmentFailure
                ? 'ATM_ENV_SANDBOX_GIT_EPERM'
                : gitIndexPermissionFailure
                    ? 'ATM_GIT_INDEX_PERMISSION_DENIED'
                    : 'ATM_GIT_INDEX_UNAVAILABLE',
        exitCode: status.exitCode,
        indexLockPath: normalizeRelativePath(relativePathFrom(cwd, indexLockPath)),
        indexLockPresent: existsSync(indexLockPath),
        stderr,
        detail,
        requiredCommand: status.exitCode === 0
            ? null
            : environmentFailure
                ? 'Rerun the same command with repository-level permissions, or set ATM_TEMP_ROOT=C:\\tmp for validators that create temporary git repositories, then retry. This is an environment diagnostic, not task evidence.'
                : 'Resolve the local Git/index permission problem outside ATM, then rerun the commit. Do not edit .git/index.lock by hand unless you have confirmed no Git process is active.'
    };
}
function classifyGitIndexFailure(stderr) {
    if (classifyGitIndexPermissionFailure(stderr)) {
        return `Git could not access the index lock (${stderr}). This is an environment or sandbox permission problem, not a task evidence failure.`;
    }
    return `Git index diagnostic failed (${stderr}).`;
}
function classifySandboxGitFailure(stderr) {
    return /spawnSync\s+git(?:\.exe)?\s+(?:EPERM|EACCES)/i.test(stderr)
        || /Error:\s+spawn\s+git(?:\.exe)?\s+(?:EPERM|EACCES)/i.test(stderr);
}
function classifyGitIndexPermissionFailure(stderr) {
    return /(?:^|[\\/])?\.?git[\\/]+index\.lock|index\.lock/i.test(stderr)
        && /permission denied|eperm|eacces|unable to create/i.test(stderr);
}
function runPrePushHook(cwd, base, head) {
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
    const enforcement = createPrePushEnforcementDecision(root, pushRefs, baseInfo, report.head);
    const hardFailure = enforcement.hardEnforcement && report.findings.length > 0 && !enforcement.safeModeActive;
    const warnOnly = report.findings.length > 0 && !hardFailure;
    const safeModeMissingMetadata = enforcement.safeModeRequested && !enforcement.safeModeActive;
    const evidenceMissingDiagnostic = report.evidenceMissingDiagnostic
        ? [message('info', 'ATM_HOOK_PRE_PUSH_GIT_HEAD_EVIDENCE_MISSING_DIAGNOSTIC', 'ATM pre-push git-head evidence-missing commits after the accepted baseline.', report.evidenceMissingDiagnostic)]
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
                        ? message('warning', enforcement.safeModeActive ? 'ATM_HOOK_PRE_PUSH_SAFE_MODE_BYPASS' : 'ATM_HOOK_PRE_PUSH_WARN_ONLY_NON_PROTECTED', enforcement.safeModeActive
                            ? 'ATM pre-push commit-range guard findings were downgraded by maintainer safe mode for this protected push.'
                            : 'ATM pre-push commit-range guard findings were downgraded to warnings because the target is not a protected framework branch.', {
                            base: baseInfo.base,
                            head: resolvedHead,
                            findings: report.findings,
                            rangeDecision: enforcement
                        })
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
function createCommitRangeGuardReport(cwd, base, head) {
    const root = path.resolve(cwd);
    const repoIdentity = detectFrameworkRepoIdentity(root);
    const legacyBaseline = repoIdentity.isFrameworkRepo ? readFrameworkCommitRangeBaseline(root, head) : null;
    const changedFiles = runGitLines(root, ['diff', '--name-only', `${base}..${head}`]).map(normalizeRelativePath);
    const criticalChangedFiles = repoIdentity.isFrameworkRepo
        ? changedFiles.filter(isAtmCriticalNonDocSurface)
        : [];
    const commits = repoIdentity.isFrameworkRepo
        ? runGitLines(root, ['rev-list', '--reverse', `${base}..${head}`])
        : [];
    const criticalCommits = commits
        .map((commitSha) => ({
        commitSha,
        criticalChangedFiles: readCommitChangedFiles(root, commitSha).filter(isAtmCriticalNonDocSurface)
    }))
        .filter((entry) => entry.criticalChangedFiles.length > 0);
    const legacyBaselineBoundaryCommitSha = legacyBaseline?.acceptedHistoryThroughCommitSha ?? legacyBaseline?.commitSha ?? null;
    const isAcceptedByLegacyBaseline = (commitSha) => legacyBaselineBoundaryCommitSha
        ? isCommitAcceptedByLegacyBaseline(root, commitSha, legacyBaselineBoundaryCommitSha)
        : false;
    const enforcedCriticalCommits = legacyBaseline
        ? criticalCommits.filter((entry) => !isAcceptedByLegacyBaseline(entry.commitSha))
        : criticalCommits;
    const evidenceMatches = criticalCommits.map((entry) => inspectCommitGitHeadEvidence(root, entry.commitSha, entry.criticalChangedFiles, head));
    const closurePacketInspections = enforcedCriticalCommits.flatMap((entry) => {
        const match = evidenceMatches.find((candidate) => candidate.commitSha === entry.commitSha);
        return inspectCommitClosurePackets(root, entry.commitSha, match ?? null, head);
    });
    const missingEvidenceMatches = evidenceMatches
        .filter((entry) => !legacyBaseline || !isAcceptedByLegacyBaseline(entry.commitSha))
        .filter((entry) => !entry.matched);
    const evidenceMissingDiagnostic = missingEvidenceMatches.length > 0
        ? {
            count: missingEvidenceMatches.length,
            samples: missingEvidenceMatches.slice(0, 5).map((entry) => ({
                commitSha: entry.commitSha,
                message: runGitScalar(root, ['log', '-1', '--format=%s', entry.commitSha]) ?? ''
            }))
        }
        : null;
    const taskAudit = auditTasks(root);
    const findings = [
        ...missingEvidenceMatches
            .map((entry) => ({
            level: 'error',
            code: 'ATM_COMMIT_RANGE_GIT_HEAD_EVIDENCE_MISSING',
            commitSha: entry.commitSha,
            detail: `Critical framework commit ${entry.commitSha} has no matching git-head evidence.`
        })),
        ...closurePacketInspections.flatMap((entry) => legacyBaseline && isAcceptedByLegacyBaseline(entry.commitSha) ? [] : entry.findings.map((finding) => ({
            level: 'error',
            code: finding.code,
            commitSha: entry.commitSha,
            detail: `${entry.packetPath}: ${finding.detail}`,
            suggestedFix: finding.suggestedFix
        }))),
        ...taskAudit.findings
            .filter((entry) => entry.level === 'error')
            .map((entry) => ({
            level: 'error',
            code: entry.code,
            commitSha: null,
            detail: entry.detail
        }))
    ];
    return {
        schemaId: 'atm.commitRangeGuardReport.v1',
        generatedAt: new Date().toISOString(),
        base,
        head,
        legacyBaseline,
        ignoredLegacyCriticalCommitCount: criticalCommits.length - enforcedCriticalCommits.length,
        repoIdentity,
        changedFiles,
        criticalChangedFiles,
        criticalCommits: enforcedCriticalCommits,
        evidenceMatches,
        evidenceMissingDiagnostic,
        closurePacketInspections,
        taskAudit,
        protectedBranchPatterns,
        findings,
        ok: findings.length === 0
    };
}
function createPrePushEnforcementDecision(cwd, pushRefs, baseInfo, headRef) {
    const pushedBranches = uniqueSorted(pushRefs.map((entry) => entry.remoteBranch).filter((entry) => Boolean(entry)));
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
    const safeModeActive = safeModeRequested && hardEnforcement && Boolean(safeModeActor) && Boolean(safeModeReason);
    const safeModeReportPath = safeModeActive
        ? writePrePushSafeModeReport(cwd, {
            targetBranches,
            hardProtectedBranchTargets,
            currentBranch: baseInfo.currentBranch,
            upstreamRef: baseInfo.upstreamRef,
            base: baseInfo.base,
            head: headRef,
            actorId: safeModeActor,
            reason: safeModeReason,
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
function readFrameworkCommitRangeBaseline(cwd, headRef) {
    const absolutePath = path.join(cwd, frameworkCommitRangeBaselineRelativePath);
    if (!existsSync(absolutePath)) {
        return null;
    }
    try {
        const parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
        const commitSha = normalizeOptionalText(parsed.commitSha);
        if (!commitSha)
            return null;
        const headCommit = runGitScalar(cwd, ['rev-parse', '--verify', headRef]);
        if (!headCommit)
            return null;
        if (!isAncestorCommit(cwd, commitSha, headCommit)) {
            return null;
        }
        return {
            schemaId: 'atm.frameworkCommitRangeBaseline.v1',
            generatedAt: normalizeOptionalText(parsed.generatedAt) ?? new Date(0).toISOString(),
            name: normalizeOptionalText(parsed.name),
            refName: normalizeOptionalText(parsed.refName),
            commitSha,
            acceptedHistoryThroughCommitSha: normalizeOptionalText(parsed.acceptedHistoryThroughCommitSha) ?? commitSha,
            strictEvidenceRequiredAfterCommitSha: normalizeOptionalText(parsed.strictEvidenceRequiredAfterCommitSha) ?? commitSha,
            rationale: normalizeOptionalText(parsed.rationale)
        };
    }
    catch {
        return null;
    }
}
function isCommitAcceptedByLegacyBaseline(cwd, commitSha, baselineCommitSha) {
    return isAncestorCommit(cwd, commitSha, baselineCommitSha);
}
function isAncestorCommit(cwd, maybeAncestor, maybeDescendant) {
    const result = runGit(cwd, ['merge-base', '--is-ancestor', maybeAncestor, maybeDescendant]);
    return result.exitCode === 0;
}
function runRequiredFrameworkValidators(cwd, requiredGates) {
    const validationPasses = requiredValidationPassesForClosure(requiredGates);
    if (validationPasses.length === 0)
        return [];
    const commands = uniqueSorted(validationPasses.map((gate) => gate === 'typecheck' ? 'npm run typecheck' : `npm run ${gate}`));
    return commands.map((command) => runShellCommandForReport(cwd, command));
}
function runCommandForReport(cwd, command, args) {
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
function runShellCommandForReport(cwd, commandLine) {
    const result = spawnSync(commandLine, {
        cwd,
        encoding: 'utf8',
        shell: true
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
function readStagedFiles(cwd) {
    return uniqueSorted(runGitLines(cwd, ['diff', '--cached', '--name-only', '--diff-filter=ACMRT'])
        .map(normalizeRelativePath)
        .filter(Boolean));
}
function readStagedChangedLineCount(cwd, files) {
    if (files.length === 0)
        return 0;
    const lines = runGitLines(cwd, ['diff', '--cached', '--numstat', '--', ...files]);
    let total = 0;
    for (const line of lines) {
        const [added, deleted] = line.split('\t');
        const addedCount = Number.parseInt(added, 10);
        const deletedCount = Number.parseInt(deleted, 10);
        if (Number.isFinite(addedCount))
            total += addedCount;
        if (Number.isFinite(deletedCount))
            total += deletedCount;
    }
    return total;
}
function scanEncoding(cwd, files) {
    const findings = [];
    for (const file of files) {
        if (!isTextFile(file))
            continue;
        const absolutePath = path.join(cwd, file);
        if (!existsSync(absolutePath))
            continue;
        const buffer = readFileSync(absolutePath);
        const text = buffer.toString('utf8');
        if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
            findings.push({ file, issue: 'utf8-bom' });
        }
        if (text.includes('\uFFFD')) {
            findings.push({ file, issue: 'replacement-character' });
        }
        if (/[\u00c3\u00e2\u00e5].|\u749d.|\u7587.|\u765f./.test(text)) {
            findings.push({ file, issue: 'possible-mojibake' });
        }
    }
    return {
        schemaId: 'atm.encodingHookReport.v1',
        inspectedFileCount: files.filter(isTextFile).length,
        findings,
        ok: findings.length === 0
    };
}
function inspectTaskCardStatusChanges(cwd, stagedFiles) {
    const findings = [];
    for (const file of stagedFiles) {
        if (!isTaskCardMarkdownPath(file))
            continue;
        const stagedText = readGitObjectText(cwd, `:${file}`);
        if (!stagedText)
            continue;
        const nextStatus = parseMarkdownTaskCardStatus(stagedText);
        if (!isDoneLikeTaskCardStatus(nextStatus))
            continue;
        const headText = readGitObjectText(cwd, `HEAD:${file}`);
        const previousStatus = headText ? parseMarkdownTaskCardStatus(headText) : null;
        if (isDoneLikeTaskCardStatus(previousStatus))
            continue;
        const taskId = parseMarkdownTaskCardId(stagedText, file);
        if (hasLocalLedgerClosure(cwd, taskId) || hasClosureSyncAttestation(stagedText))
            continue;
        findings.push({
            file,
            taskId,
            previousStatus,
            nextStatus: nextStatus ?? 'done',
            reason: 'planning-card-done-without-ledger-closure',
            detail: `Task card ${file} changes status to done, but ATM could not verify a matching task ledger closure packet. Planning cards are mirrors; close the task through ATM before syncing status.`,
            requiredCommand: `node atm.mjs next --prompt ${JSON.stringify(taskId)} --json`
        });
    }
    return {
        schemaId: 'atm.taskCardStatusPreCommitReport.v1',
        inspectedFileCount: stagedFiles.filter(isTaskCardMarkdownPath).length,
        findings,
        ok: findings.length === 0
    };
}
function isTaskCardMarkdownPath(file) {
    return normalizeRelativePath(file).toLowerCase().endsWith('.task.md');
}
function parseMarkdownTaskCardStatus(text) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? text.slice(0, 2000);
    const match = /^status:\s*['"]?([^'"\r\n#]+)['"]?\s*$/im.exec(frontmatter);
    return match ? match[1].trim().toLowerCase() : null;
}
function parseMarkdownTaskCardId(text, file) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? text.slice(0, 2000);
    const match = /^(?:task_id|taskId|workItemId|id):\s*['"]?([^'"\r\n#]+)['"]?\s*$/im.exec(frontmatter);
    const fallback = path.basename(file).replace(/\.task\.md$/i, '');
    return (match?.[1]?.trim() || fallback).toUpperCase();
}
function isDoneLikeTaskCardStatus(status) {
    return status === 'done' || status === 'verified';
}
function hasLocalLedgerClosure(cwd, taskId) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(taskPath))
        return false;
    try {
        const parsed = readJsonText(readFileSync(taskPath, 'utf8'));
        if (!parsed || !isDoneLikeTaskCardStatus(normalizeOptionalText(parsed.status)?.toLowerCase() ?? null))
            return false;
        const closurePacket = normalizeOptionalText(parsed.closurePacket ?? parsed.closure_packet);
        if (!closurePacket)
            return false;
        return existsSync(path.join(cwd, closurePacket));
    }
    catch {
        return false;
    }
}
function hasClosureSyncAttestation(text) {
    return /Closure sync:/i.test(text)
        && /\.closure-packet\.json/i.test(text)
        && /\b[0-9a-f]{7,40}\b/i.test(text);
}
function readGitObjectText(cwd, ref) {
    const result = runGit(cwd, ['show', ref]);
    return result.exitCode === 0 ? result.stdout : null;
}
function writeStagedGitHeadEvidence(cwd, stagedFiles, commandRuns) {
    const treeSha = readStagedTreeWithoutEvidence(cwd);
    const parentCommitShas = readCurrentHeadForFutureCommit(cwd);
    const generatedAt = new Date().toISOString();
    const evidenceAbsolute = path.join(cwd, gitHeadEvidencePath);
    mkdirSync(path.dirname(evidenceAbsolute), { recursive: true });
    const payload = {
        schemaVersion: 'atm.gitHeadEvidence.v0.1',
        evidence: [
            {
                evidenceKind: 'validation',
                summary: 'Git commit tree is covered by ATM Integration Hook Contract v1.',
                artifactPaths: [],
                createdAt: generatedAt,
                producedBy: hookProvider,
                commandRuns,
                details: {
                    git: {
                        treeSha,
                        parentCommitShas,
                        stagedPathCount: stagedFiles.length,
                        evidencePath: gitHeadEvidencePath,
                        generatedAt
                    },
                    hookContractVersion,
                    runnerVersion: readFrameworkVersion(cwd)
                }
            }
        ]
    };
    appendFileSync(evidenceAbsolute, `${JSON.stringify(payload)}\n`, 'utf8');
    const addResult = runGit(cwd, ['add', '--', gitHeadEvidencePath]);
    return {
        evidencePath: gitHeadEvidencePath,
        treeSha,
        parentCommitShas,
        gitAddExitCode: addResult.exitCode,
        ok: addResult.exitCode === 0
    };
}
function readStagedTreeWithoutEvidence(cwd) {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-hook-index-'));
    const tempIndex = path.join(tempDir, 'index');
    try {
        const gitIndexPath = runGitScalar(cwd, ['rev-parse', '--git-path', 'index']);
        if (gitIndexPath) {
            const absoluteIndex = path.resolve(cwd, gitIndexPath);
            if (existsSync(absoluteIndex)) {
                writeFileSync(tempIndex, readFileSync(absoluteIndex));
            }
        }
        runGit(cwd, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--force', '--', gitHeadEvidencePaths.legacyJson, gitHeadEvidencePaths.jsonl], { GIT_INDEX_FILE: tempIndex });
        const tree = runGit(cwd, ['write-tree'], { GIT_INDEX_FILE: tempIndex });
        return tree.exitCode === 0 ? tree.stdout.trim() : null;
    }
    finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}
function readGitHeadEvidenceRecordsAtRef(cwd, ref) {
    const jsonlText = runGitScalar(cwd, ['show', `${ref}:${gitHeadEvidencePaths.jsonl}`]);
    if (jsonlText) {
        return jsonlText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .flatMap((line) => {
            try {
                return extractEvidenceRecords(JSON.parse(line));
            }
            catch {
                return [];
            }
        });
    }
    const legacyText = runGitScalar(cwd, ['show', `${ref}:${gitHeadEvidencePaths.legacyJson}`]);
    const evidence = legacyText ? readJsonText(legacyText) : null;
    return extractEvidenceRecords(evidence);
}
function inspectCommitGitHeadEvidence(cwd, commitSha, criticalChangedFiles, headRef = 'HEAD') {
    const records = [
        ...readGitHeadEvidenceRecordsAtRef(cwd, commitSha),
        ...readGitHeadEvidenceRecordsAtRef(cwd, headRef)
    ];
    const commitTreeSha = runGitScalar(cwd, ['rev-parse', `${commitSha}^{tree}`]);
    const governedTreeSha = readCommitTreeWithoutEvidence(cwd, commitSha);
    const parentCommitShas = readParentCommitShas(cwd, commitSha);
    const candidates = records.flatMap((record) => {
        const git = normalizeGitDetails(record?.details?.git);
        if (!git)
            return [];
        const commandRuns = normalizeCommandRuns(record?.commandRuns ?? record?.details?.commandRuns);
        const validationPasses = inferValidationPassesFromCommandRuns(commandRuns);
        return [{ git, commandRuns, validationPasses }];
    });
    for (const candidate of candidates) {
        const { git, commandRuns, validationPasses } = candidate;
        if (git.commitSha === commitSha) {
            return {
                commitSha,
                criticalChangedFiles,
                evidencePath: gitHeadEvidencePath,
                matched: true,
                matchedBy: 'commitSha',
                gitDetails: git,
                commandRuns,
                validationPasses
            };
        }
    }
    for (const candidate of candidates) {
        const { git, commandRuns, validationPasses } = candidate;
        if (!git.commitSha && git.parentCommitShas.length === 1 && git.parentCommitShas[0] === commitSha) {
            return {
                commitSha,
                criticalChangedFiles,
                evidencePath: gitHeadEvidencePath,
                matched: true,
                matchedBy: 'evidenceOnlyParentCommitSha',
                gitDetails: git,
                commandRuns,
                validationPasses
            };
        }
    }
    for (const candidate of candidates) {
        const { git, commandRuns, validationPasses } = candidate;
        if (git.treeSha && (git.treeSha === governedTreeSha || git.treeSha === commitTreeSha) && sameStringSet(git.parentCommitShas, parentCommitShas)) {
            return {
                commitSha,
                criticalChangedFiles,
                evidencePath: gitHeadEvidencePath,
                matched: true,
                matchedBy: 'treeSha+parentCommitShas',
                gitDetails: git,
                commandRuns,
                validationPasses
            };
        }
    }
    return {
        commitSha,
        criticalChangedFiles,
        evidencePath: gitHeadEvidencePath,
        matched: false,
        matchedBy: null,
        gitDetails: null,
        commandRuns: [],
        validationPasses: []
    };
}
function inspectCommitClosurePackets(cwd, commitSha, evidenceMatch, headRef = 'HEAD') {
    const commitChangedFiles = readCommitChangedFiles(cwd, commitSha);
    const closurePacketPaths = commitChangedFiles.filter((entry) => entry.startsWith('.atm/history/evidence/') && entry.endsWith('.closure-packet.json'));
    if (closurePacketPaths.length === 0)
        return [];
    return closurePacketPaths.map((packetPath) => {
        const packetText = runGitScalar(cwd, ['show', `${commitSha}:${packetPath}`]);
        const packet = packetText ? readJsonText(packetText) : null;
        const directInspection = inspectClosurePacketAgainstCommit(cwd, commitSha, packetPath, packet, evidenceMatch);
        if (directInspection.findings.length === 0)
            return directInspection;
        const repairMetadata = extractClosurePacketRepairMetadata(packet);
        if (repairMetadata?.originalPacketCommitSha && repairMetadata.originalPacketCommitSha !== commitSha) {
            const repairEvidenceMatch = inspectCommitGitHeadEvidence(cwd, repairMetadata.originalPacketCommitSha, [], headRef);
            const repairInspection = inspectClosurePacketAgainstCommit(cwd, repairMetadata.originalPacketCommitSha, packetPath, packet, repairEvidenceMatch);
            if (repairInspection.findings.length === 0) {
                return { commitSha, packetPath, taskId: repairInspection.taskId, findings: [] };
            }
        }
        const headPacketText = runGitScalar(cwd, ['show', `${headRef}:${packetPath}`]);
        const headPacket = headPacketText && headPacketText !== packetText ? readJsonText(headPacketText) : null;
        const headRepairMetadata = extractClosurePacketRepairMetadata(headPacket);
        const headRepairTargetCommit = extractClosurePacketTargetCommitSha(headPacket);
        if (headRepairMetadata?.originalPacketCommitSha === commitSha && headRepairTargetCommit === commitSha) {
            const repairEvidenceMatch = inspectCommitGitHeadEvidence(cwd, commitSha, [], headRef);
            const repairInspection = inspectClosurePacketAgainstCommit(cwd, commitSha, packetPath, headPacket, repairEvidenceMatch);
            if (repairInspection.findings.length === 0) {
                return { commitSha, packetPath, taskId: repairInspection.taskId, findings: [] };
            }
        }
        return directInspection;
    });
}
function extractClosurePacketRepairMetadata(packet) {
    if (!packet || typeof packet !== 'object' || Array.isArray(packet))
        return null;
    const repair = packet.repair;
    if (!repair || typeof repair !== 'object' || Array.isArray(repair))
        return null;
    const record = repair;
    const schemaId = normalizeOptionalText(record.schemaId);
    if (schemaId !== 'atm.closurePacketRepair.v1')
        return null;
    return {
        schemaId,
        originalPacketCommitSha: normalizeOptionalText(record.originalPacketCommitSha),
        repairedTargetCommitSha: normalizeOptionalText(record.repairedTargetCommitSha)
    };
}
function extractClosurePacketTargetCommitSha(packet) {
    if (!packet || typeof packet !== 'object' || Array.isArray(packet))
        return null;
    const delta = packet.targetCommitDelta;
    if (!delta || typeof delta !== 'object' || Array.isArray(delta))
        return null;
    return normalizeOptionalText(delta.currentCommitSha);
}
function inspectClosurePacketAgainstCommit(cwd, commitSha, packetPath, packet, evidenceMatch) {
    const commitChangedFiles = readCommitChangedFiles(cwd, commitSha);
    const parentCommitShas = readParentCommitShas(cwd, commitSha);
    const governedTreeSha = readCommitTreeWithoutEvidence(cwd, commitSha);
    const commitChangedSet = new Set(commitChangedFiles.map((entry) => normalizeRelativePath(entry)));
    const findings = [];
    const validation = validateClosurePacket(packet);
    const taskId = typeof packet?.taskId === 'string'
        ? String(packet.taskId)
        : null;
    if (!validation.ok) {
        const invalidFormatSummary = validation.invalidFormat.length > 0
            ? `; invalidFormat=${validation.invalidFormat.map((entry) => entry.path).join(', ')}`
            : '';
        findings.push({
            code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_INVALID',
            detail: `closure packet contract is incomplete (${validation.missing.join(', ')}${invalidFormatSummary})`
        });
        return { commitSha, packetPath, taskId, findings };
    }
    const normalizedPacket = packet;
    const packetTargetCommit = normalizeOptionalText(normalizedPacket.targetCommit);
    const packetTreeSha = normalizeOptionalText(normalizedPacket.targetCommitDelta?.governedTreeSha ?? normalizedPacket.governedTreeSha);
    const packetParentCommitShas = normalizeStringArray(normalizedPacket.targetCommitDelta?.parentCommitShas);
    const packetChangedFiles = normalizeStringArray(normalizedPacket.targetCommitDelta?.changedFiles).map(normalizeRelativePath).filter(Boolean);
    const invalidChangedFiles = packetChangedFiles.filter((entry) => !commitChangedSet.has(entry));
    if (invalidChangedFiles.length > 0) {
        findings.push({
            code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_CHANGED_FILES_MISMATCH',
            detail: `targetCommitDelta.changedFiles includes files not present in commit ${commitSha}: ${invalidChangedFiles.join(', ')}`
        });
    }
    if (!sameStringSet(packetParentCommitShas, parentCommitShas)) {
        findings.push({
            code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_PARENT_MISMATCH',
            detail: `targetCommitDelta.parentCommitShas does not match commit parents for ${commitSha}.`
        });
    }
    if (packetTargetCommit && !parentCommitShas.includes(packetTargetCommit)) {
        findings.push({
            code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_TARGET_COMMIT_MISMATCH',
            detail: `targetCommit ${packetTargetCommit} is not a parent of commit ${commitSha}.`
        });
    }
    if (packetTreeSha && governedTreeSha && packetTreeSha !== governedTreeSha) {
        findings.push({
            code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_TREE_MISMATCH',
            detail: `targetCommitDelta.governedTreeSha ${packetTreeSha} does not match governed tree ${governedTreeSha} for commit ${commitSha}.`,
            suggestedFix: buildClosurePacketRepairSuggestedFix(taskId)
        });
    }
    if (evidenceMatch?.matched) {
        const evidenceTreeSha = normalizeOptionalText(evidenceMatch.gitDetails?.treeSha);
        if (packetTreeSha && evidenceTreeSha && packetTreeSha !== evidenceTreeSha) {
            findings.push({
                code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_GIT_HEAD_TREE_MISMATCH',
                detail: `closure packet governedTreeSha ${packetTreeSha} is not the same tree recorded by git-head evidence (${evidenceTreeSha}).`
            });
        }
        if (evidenceMatch.gitDetails && !sameStringSet(packetParentCommitShas, evidenceMatch.gitDetails.parentCommitShas)) {
            findings.push({
                code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_GIT_HEAD_PARENT_MISMATCH',
                detail: 'closure packet parent commit set does not match git-head evidence parent commit set.'
            });
        }
        const packetCommandRuns = normalizeCommandRuns(normalizedPacket.commandRuns ?? []);
        const missingCommandRuns = packetCommandRuns.filter((entry) => !evidenceMatch.commandRuns.some((candidate) => sameComparableCommandRun(candidate, entry)));
        if (missingCommandRuns.length > 0) {
            findings.push({
                code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_COMMAND_RUN_MISMATCH',
                detail: `closure packet commandRuns are not fully backed by git-head evidence (${missingCommandRuns.map((entry) => entry.command).join(', ')}).`
            });
        }
        const requiredValidationPasses = requiredValidationPassesForClosure(normalizeStringArray(normalizedPacket.requiredGates));
        const missingValidationPasses = requiredValidationPasses.filter((entry) => !evidenceMatch.validationPasses.includes(entry));
        if (missingValidationPasses.length > 0) {
            findings.push({
                code: 'ATM_COMMIT_RANGE_CLOSURE_PACKET_VALIDATION_MISMATCH',
                detail: `git-head evidence does not prove all required validation passes (${missingValidationPasses.join(', ')}).`
            });
        }
    }
    return { commitSha, packetPath, taskId, findings };
}
function buildClosurePacketRepairSuggestedFix(taskId) {
    const taskArg = taskId && taskId.trim().length > 0 ? taskId.trim() : '<taskId>';
    return `Repair the closure-packet metadata with node atm.mjs tasks repair-closure --task ${taskArg} --json or node atm.mjs rescue closure-packet --task ${taskArg} --json, then rerun the governed commit-range check.`;
}
function readCommitTreeWithoutEvidence(cwd, commitSha) {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-commit-range-index-'));
    const tempIndex = path.join(tempDir, 'index');
    try {
        const readTree = runGit(cwd, ['read-tree', commitSha], { GIT_INDEX_FILE: tempIndex });
        if (readTree.exitCode !== 0)
            return null;
        runGit(cwd, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--force', '--', gitHeadEvidencePaths.legacyJson, gitHeadEvidencePaths.jsonl], { GIT_INDEX_FILE: tempIndex });
        const tree = runGit(cwd, ['write-tree'], { GIT_INDEX_FILE: tempIndex });
        return tree.exitCode === 0 ? tree.stdout.trim() : null;
    }
    finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}
function readCommitChangedFiles(cwd, commitSha) {
    const args = hasParent(cwd, commitSha)
        ? ['diff-tree', '--no-commit-id', '--name-only', '-r', commitSha]
        : ['show', '--name-only', '--format=', '--root', commitSha];
    return runGitLines(cwd, args).map(normalizeRelativePath).filter(Boolean);
}
function hasParent(cwd, commitSha) {
    return readParentCommitShas(cwd, commitSha).length > 0;
}
function readParentCommitShas(cwd, commitSha) {
    const row = runGitScalar(cwd, ['rev-list', '--parents', '-n', '1', commitSha]);
    return row ? row.split(/\s+/).slice(1).filter(Boolean) : [];
}
function readCurrentHeadForFutureCommit(cwd) {
    const head = runGitScalar(cwd, ['rev-parse', '--verify', 'HEAD']);
    return head ? [head] : [];
}
function resolvePushBase(cwd, explicitBase) {
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
function createGitHookScript(hookName) {
    const command = hookName === 'pre-commit'
        ? 'node atm.mjs hook pre-commit --json'
        : 'node atm.mjs hook pre-push --json';
    return [
        '#!/usr/bin/env sh',
        'set -eu',
        `# ${hookMarker}`,
        '',
        'repo_root="$(git rev-parse --show-toplevel)"',
        'cd "$repo_root"',
        '',
        command,
        ''
    ].join('\n');
}
function inspectHookFile(cwd, hookName) {
    const relativePath = `.atm/git-hooks/${hookName}`;
    const absolutePath = path.join(cwd, relativePath);
    if (!existsSync(absolutePath)) {
        return { path: relativePath, present: false, markerPresent: false, sha256: null };
    }
    const text = readFileSync(absolutePath, 'utf8');
    return {
        path: relativePath,
        present: true,
        markerPresent: text.includes(hookMarker) && text.includes(`node atm.mjs hook ${hookName}`),
        sha256: sha256(readFileSync(absolutePath))
    };
}
function readPrePushRefUpdates() {
    if (process.stdin.isTTY)
        return [];
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
    }
    catch {
        return [];
    }
}
function parseHookArgs(argv) {
    const state = {
        cwd: process.cwd(),
        action: null,
        base: null,
        head: null
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
        if (arg === '--json' || arg === '--pretty')
            continue;
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
function parseGitHooksArgs(argv) {
    const state = {
        cwd: process.cwd(),
        action: null,
        frameworkRequired: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd' || arg === '--repo') {
            state.cwd = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--framework-required') {
            state.frameworkRequired = true;
            continue;
        }
        if (arg === '--json' || arg === '--pretty')
            continue;
        if (arg !== 'install' && arg !== 'verify') {
            throw new CliError('ATM_CLI_USAGE', 'git-hooks supports only: install, verify', { exitCode: 2 });
        }
        state.action = arg;
    }
    if (!state.action) {
        throw new CliError('ATM_CLI_USAGE', 'git-hooks requires an action: install | verify', { exitCode: 2 });
    }
    return {
        cwd: path.resolve(state.cwd),
        action: state.action,
        frameworkRequired: state.frameworkRequired
    };
}
function parseCommitRangeArgs(argv) {
    const state = {
        cwd: process.cwd(),
        base: null,
        head: null
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === 'commit-range') {
            continue;
        }
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
        if (arg === '--json' || arg === '--pretty')
            continue;
        throw new CliError('ATM_CLI_USAGE', `guard commit-range does not support argument ${arg}`, { exitCode: 2 });
    }
    if (!state.base || !state.head) {
        throw new CliError('ATM_CLI_USAGE', 'guard commit-range requires --base <ref> and --head <ref>.', { exitCode: 2 });
    }
    return {
        cwd: path.resolve(state.cwd),
        base: state.base,
        head: state.head
    };
}
function isTextFile(filePath) {
    return textFileExtensions.has(path.extname(filePath).toLowerCase())
        || path.basename(filePath).includes('AGENTS')
        || path.basename(filePath).includes('README');
}
function extractEvidenceRecords(value) {
    if (Array.isArray(value))
        return value.filter((entry) => entry && typeof entry === 'object');
    if (!value || typeof value !== 'object')
        return [];
    const candidate = value;
    if (Array.isArray(candidate.evidence))
        return candidate.evidence.filter((entry) => entry && typeof entry === 'object');
    if (Array.isArray(candidate.checks))
        return candidate.checks.filter((entry) => entry && typeof entry === 'object');
    return candidate.evidenceKind || candidate.details ? [candidate] : [];
}
function normalizeGitDetails(value) {
    if (!value || typeof value !== 'object')
        return null;
    const candidate = value;
    return {
        commitSha: typeof candidate.commitSha === 'string' ? candidate.commitSha.trim() : null,
        treeSha: typeof candidate.treeSha === 'string' ? candidate.treeSha.trim() : null,
        parentCommitShas: Array.isArray(candidate.parentCommitShas)
            ? candidate.parentCommitShas.map((entry) => String(entry).trim()).filter(Boolean)
            : []
    };
}
function normalizeCommandRuns(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => {
        const candidate = entry;
        const command = normalizeOptionalText(candidate.command);
        const exitCode = Number(candidate.exitCode);
        const stdoutSha256 = normalizeOptionalText(candidate.stdoutSha256);
        const stderrSha256 = normalizeOptionalText(candidate.stderrSha256);
        if (!command || !Number.isFinite(exitCode) || !stdoutSha256 || !stderrSha256)
            return null;
        return {
            command,
            exitCode,
            stdoutSha256,
            stderrSha256
        };
    })
        .filter((entry) => entry !== null);
}
function inferValidationPassesFromCommandRuns(commandRuns) {
    const passes = new Set();
    for (const commandRun of commandRuns) {
        const command = commandRun.command.trim();
        const validateMatch = command.match(/\bnpm(?:\.cmd)?\s+run\s+(validate:[a-z0-9:-]+)\b/i);
        if (validateMatch) {
            passes.add(validateMatch[1]);
            continue;
        }
        if (/\bnpm(?:\.cmd)?\s+run\s+typecheck\b/i.test(command)) {
            passes.add('typecheck');
        }
    }
    return [...passes].sort((left, right) => left.localeCompare(right));
}
function normalizeStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((entry) => String(entry).trim()).filter(Boolean);
}
function normalizeOptionalText(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function sameComparableCommandRun(left, right) {
    return left.command === right.command
        && left.exitCode === right.exitCode
        && left.stdoutSha256 === right.stdoutSha256
        && left.stderrSha256 === right.stderrSha256;
}
function readJsonText(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
function runGitLines(cwd, args) {
    const result = runGit(cwd, args);
    if (result.exitCode !== 0)
        return [];
    return result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}
function runGitScalar(cwd, args) {
    const result = runGit(cwd, args);
    return result.exitCode === 0 && result.stdout.trim().length > 0 ? result.stdout.trim() : null;
}
function runGit(cwd, args, env = {}) {
    const result = spawnSync('git', [...args], {
        cwd,
        env: { ...process.env, ...env },
        encoding: 'utf8'
    });
    return {
        exitCode: typeof result.status === 'number' ? result.status : 1,
        stdout: String(result.stdout ?? ''),
        stderr: [String(result.stderr ?? ''), result.error?.message ?? ''].filter(Boolean).join('\n')
    };
}
function normalizeGitConfigPath(value) {
    return value ? value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') : null;
}
function deriveBranchesFromRef(ref) {
    const normalized = normalizeRemoteBranch(ref);
    return normalized ? [normalized] : [];
}
function normalizeRemoteBranch(ref) {
    const normalized = normalizeOptionalText(ref)?.replace(/\\/g, '/');
    if (!normalized)
        return null;
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
function isProtectedFrameworkBranchTarget(branch) {
    const normalized = normalizeOptionalText(branch)?.replace(/\\/g, '/');
    if (!normalized)
        return false;
    return normalized === 'main'
        || normalized === 'master'
        || normalized === 'trunk'
        || normalized.startsWith('release/');
}
function isTruthyEnv(value) {
    const normalized = normalizeOptionalText(value);
    return normalized === '1' || normalized?.toLowerCase() === 'true';
}
function writePrePushSafeModeReport(cwd, input) {
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
    return relativePathFrom(root, absolutePath);
}
function isTaskDirectionPreCommitExempt(value) {
    const normalized = normalizeRelativePath(value).toLowerCase();
    return normalized.startsWith('.atm/history/task-events/')
        || normalized.startsWith('.atm/history/evidence/')
        || normalized.startsWith('.atm/runtime/locks/')
        || normalized.startsWith('.atm/runtime/task-queues/')
        || normalized.startsWith('.atm/runtime/batch-runs/')
        || normalized.startsWith('.atm/runtime/task-direction-locks/');
}
function collectStagedBatchCheckpointScopeFiles(cwd, stagedFiles) {
    const stagedSet = new Set(stagedFiles.map((entry) => normalizeRelativePath(entry)));
    const allowedFiles = [];
    for (const file of stagedFiles) {
        const normalized = normalizeRelativePath(file);
        const lower = normalized.toLowerCase();
        if (!lower.startsWith('.atm/history/tasks/') || !lower.endsWith('.json')) {
            continue;
        }
        const task = readJsonFile(path.join(cwd, normalized));
        if (task?.status !== 'done')
            continue;
        const taskId = typeof task.workItemId === 'string' ? task.workItemId : path.basename(normalized, '.json');
        const lastTransitionId = typeof task.lastTransitionId === 'string' ? task.lastTransitionId : '';
        const expectedEventPath = `.atm/history/task-events/${taskId}/${lastTransitionId}.json`;
        if (!lastTransitionId || !stagedSet.has(expectedEventPath)) {
            continue;
        }
        const event = readJsonFile(path.join(cwd, expectedEventPath));
        const closure = event?.closure;
        if (typeof event?.command !== 'string'
            || !event.command.startsWith('node atm.mjs tasks close')
            || (!event.command.includes('--from-batch-checkpoint') && closure?.schemaId !== 'atm.taskClosureTransition.v1')) {
            continue;
        }
        allowedFiles.push(normalized);
        allowedFiles.push(...extractCheckpointTaskScopeFiles(task));
    }
    return uniqueSorted(allowedFiles);
}
function collectFrameworkTempClaimAllowedFiles(cwd) {
    const lockRoot = path.join(cwd, '.atm', 'runtime', 'locks');
    if (!existsSync(lockRoot))
        return [];
    const allowedFiles = [];
    for (const entry of readdirSync(lockRoot).filter((fileName) => fileName.startsWith('ATM-FRAMEWORK-TEMP-') && fileName.endsWith('.lock.json'))) {
        const lock = readJsonFile(path.join(lockRoot, entry));
        collectStringArrayField(lock?.files, allowedFiles);
    }
    return uniqueSorted(allowedFiles.map(normalizeRelativePath).filter(isTaskDirectionPathCandidate));
}
function extractCheckpointTaskScopeFiles(task) {
    const candidates = [];
    collectStringArrayField(task.scope, candidates);
    collectStringArrayField(task.scopePaths, candidates);
    collectStringArrayField(task.deliverables, candidates);
    collectStringArrayField(task.files, candidates);
    collectStringArrayField(task.allowedFiles, candidates);
    const targetWork = isPlainObject(task.targetWork) ? task.targetWork : null;
    if (targetWork) {
        collectStringArrayField(targetWork.allowedFiles, candidates);
        collectStringArrayField(targetWork.files, candidates);
    }
    return uniqueSorted(candidates
        .map(normalizeRelativePath)
        .filter(isTaskDirectionPathCandidate));
}
function collectStringArrayField(value, output) {
    if (!Array.isArray(value))
        return;
    for (const entry of value) {
        if (typeof entry === 'string')
            output.push(entry);
    }
}
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function inspectProtectedAtmStateChanges(cwd, stagedFiles) {
    const protectedFiles = stagedFiles.filter((entry) => isProtectedAtmManagedStatePath(entry) || isStaticEvidenceArtifactPath(entry));
    const findings = [];
    const activeBatches = listActiveBatchRuns(cwd);
    const stagedBatch = activeBatches.find((batchRun) => batchRun.taskIds.some((taskId) => protectedFiles.some((file) => normalizeRelativePath(file).toLowerCase() === `.atm/history/tasks/${taskId.toLowerCase()}.json`))) ?? null;
    const nonAtmStagedFiles = stagedFiles
        .map((entry) => normalizeRelativePath(entry))
        .filter((entry) => !entry.toLowerCase().startsWith('.atm/'));
    if (stagedBatch?.status === 'active'
        && nonAtmStagedFiles.length > 0
        && !hasStagedBatchCheckpointClosure(cwd, protectedFiles, stagedBatch.taskIds, stagedBatch.batchId)) {
        const requiredCommand = `node atm.mjs batch checkpoint --actor <id> --batch ${stagedBatch.batchId} --json`;
        findings.push({
            file: nonAtmStagedFiles[0] ?? '<staged-files>',
            reason: 'batch-commit-before-checkpoint',
            detail: `Active batch ${stagedBatch.batchId} has not checkpointed the staged deliverable commit. Run ${requiredCommand} first, then commit the deliverables together with the checkpoint task/evidence/events.`,
            requiredCommand
        });
    }
    if (protectedFiles.length === 0) {
        return {
            ok: findings.length === 0,
            files: [],
            findings
        };
    }
    const stagedTaskIds = inferTaskIdsFromStagedFiles(stagedFiles);
    if (stagedTaskIds.length === 1 && inspectHistoricalLedgerRestoreStagedArtifacts(cwd, stagedTaskIds[0], stagedFiles).ok) {
        return {
            ok: findings.length === 0,
            files: protectedFiles,
            findings
        };
    }
    const stagedSet = new Set(protectedFiles.map((entry) => normalizeRelativePath(entry)));
    for (const file of protectedFiles) {
        const normalized = normalizeRelativePath(file);
        const lower = normalized.toLowerCase();
        const absolutePath = path.join(cwd, normalized);
        if (isProtectedAtmRuntimeStatePath(normalized)) {
            findings.push({
                file: normalized,
                reason: 'runtime-state-must-not-be-committed',
                detail: 'Runtime lock, queue, or active-session state must stay ephemeral and must not be committed.'
            });
            continue;
        }
        if (lower.startsWith('.atm/history/task-events/')) {
            const event = readJsonFile(absolutePath);
            const command = typeof event?.command === 'string' ? event.command.trim() : '';
            if (event?.schemaId !== 'atm.taskTransition.v1' || typeof event?.transitionId !== 'string' || typeof event?.taskId !== 'string') {
                findings.push({
                    file: normalized,
                    reason: 'task-transition-json-invalid',
                    detail: 'Task transition event is missing atm.taskTransition.v1 metadata.'
                });
                continue;
            }
            if (!command.startsWith('node atm.mjs ')) {
                findings.push({
                    file: normalized,
                    reason: 'task-transition-command-invalid',
                    detail: 'Task transition event does not record a node atm.mjs command as its source.'
                });
            }
            continue;
        }
        if (lower.startsWith('.atm/history/tasks/')) {
            const task = readJsonFile(absolutePath);
            const taskId = typeof task?.workItemId === 'string' ? task.workItemId : path.basename(normalized, '.json');
            const lastTransitionId = typeof task?.lastTransitionId === 'string' ? task.lastTransitionId : '';
            const expectedEventPath = `.atm/history/task-events/${taskId}/${lastTransitionId}.json`;
            if (!lastTransitionId || !stagedSet.has(expectedEventPath)) {
                findings.push({
                    file: normalized,
                    reason: 'task-file-missing-transition',
                    detail: 'Task ledger change must be committed with its matching staged task transition event.'
                });
                continue;
            }
            const event = readJsonFile(path.join(cwd, expectedEventPath));
            const expectedSha = sha256(readFileSync(absolutePath));
            const owningBatch = activeBatches.find((batchRun) => batchRun.taskIds.includes(taskId)) ?? null;
            if (event?.schemaId !== 'atm.taskTransition.v1'
                || event?.transitionId !== lastTransitionId
                || event?.taskId !== taskId
                || event?.taskPath !== normalized
                || event?.taskSha256 !== expectedSha
                || typeof event?.command !== 'string'
                || !event.command.startsWith('node atm.mjs ')) {
                findings.push({
                    file: normalized,
                    reason: 'task-file-transition-mismatch',
                    detail: 'Task ledger change does not match a valid staged ATM CLI transition event.'
                });
            }
            else if (owningBatch?.status === 'active'
                && typeof event?.command === 'string'
                && event.command.startsWith('node atm.mjs tasks close')
                && !event.command.includes('--from-batch-checkpoint')
                && event?.closure?.schemaId !== 'atm.taskClosureTransition.v1') {
                const requiredCommand = `node atm.mjs batch checkpoint --actor <id> --batch ${owningBatch.batchId} --json`;
                findings.push({
                    file: normalized,
                    reason: 'batch-close-must-use-checkpoint',
                    detail: `Task ${taskId} belongs to active batch ${owningBatch.batchId}; direct tasks close is not allowed. Use batch checkpoint so ATM can close, advance, and claim the next queue head.`,
                    requiredCommand
                });
            }
            continue;
        }
        if (lower.startsWith('.atm/history/evidence/')) {
            const evidence = readJsonFile(absolutePath);
            const taskId = typeof evidence?.taskId === 'string' ? evidence.taskId : path.basename(normalized, '.json');
            const hasSiblingTask = stagedSet.has(`.atm/history/tasks/${taskId}.json`);
            const hasSiblingEvent = protectedFiles.some((entry) => {
                const candidate = normalizeRelativePath(entry).toLowerCase();
                return candidate.startsWith(`.atm/history/task-events/${taskId.toLowerCase()}/`);
            });
            if (!hasSiblingTask && !hasSiblingEvent) {
                findings.push({
                    file: normalized,
                    reason: 'evidence-file-missing-task-context',
                    detail: 'Evidence updates must travel with the related staged task ledger change or transition event.'
                });
            }
        }
        if (isStaticEvidenceArtifactPath(normalized)) {
            const hasSiblingEvidence = protectedFiles.some((entry) => {
                const candidate = normalizeRelativePath(entry).toLowerCase();
                return candidate.startsWith('.atm/history/evidence/');
            });
            const hasSiblingTaskOrEvent = protectedFiles.some((entry) => {
                const candidate = normalizeRelativePath(entry).toLowerCase();
                return candidate.startsWith('.atm/history/tasks/') || candidate.startsWith('.atm/history/task-events/');
            });
            if (!hasSiblingEvidence || !hasSiblingTaskOrEvent) {
                findings.push({
                    file: normalized,
                    reason: 'static-evidence-artifact-without-cli-context',
                    detail: 'Static evidence artifacts under atomic_workbench/evidence or atomic_workbench/reports cannot stand alone; commit them together with ATM CLI evidence/task transition context.'
                });
            }
        }
    }
    return {
        ok: findings.length === 0,
        files: protectedFiles,
        findings
    };
}
function hasStagedBatchCheckpointClosure(cwd, protectedFiles, batchTaskIds, batchId = null) {
    const protectedSet = new Set(protectedFiles.map((entry) => normalizeRelativePath(entry)));
    for (const file of protectedFiles) {
        const normalized = normalizeRelativePath(file);
        const lower = normalized.toLowerCase();
        if (!lower.startsWith('.atm/history/tasks/') || !lower.endsWith('.json')) {
            continue;
        }
        const task = readJsonFile(path.join(cwd, normalized));
        const taskId = typeof task?.workItemId === 'string' ? task.workItemId : path.basename(normalized, '.json');
        if (!batchTaskIds.includes(taskId) || task?.status !== 'done') {
            continue;
        }
        const lastTransitionId = typeof task?.lastTransitionId === 'string' ? task.lastTransitionId : '';
        const expectedEventPath = `.atm/history/task-events/${taskId}/${lastTransitionId}.json`;
        if (!lastTransitionId || !protectedSet.has(expectedEventPath)) {
            continue;
        }
        const event = readJsonFile(path.join(cwd, expectedEventPath));
        const closure = event?.closure;
        if (typeof event?.command === 'string'
            && event.command.startsWith('node atm.mjs tasks close')
            && (event.command.includes('--from-batch-checkpoint') || closure?.schemaId === 'atm.taskClosureTransition.v1')
            && (!batchId || event.command.includes(`--batch ${batchId}`) || closure?.batchId === batchId)) {
            return true;
        }
    }
    return false;
}
function isProtectedAtmManagedStatePath(value) {
    const normalized = normalizeRelativePath(value).toLowerCase();
    return normalized.startsWith('.atm/history/tasks/')
        || normalized.startsWith('.atm/history/task-events/')
        || normalized.startsWith('.atm/history/evidence/')
        || isProtectedAtmRuntimeStatePath(normalized);
}
function inspectCommitAttribution(cwd, stagedFiles) {
    const actorId = normalizeOptionalText(process.env.ATM_COMMIT_ACTOR_ID);
    const taskId = normalizeOptionalText(process.env.ATM_COMMIT_TASK_ID);
    const claimLeaseId = normalizeOptionalText(process.env.ATM_COMMIT_CLAIM_LEASE_ID);
    const sessionId = normalizeOptionalText(process.env.ATM_COMMIT_SESSION_ID);
    const stagedTaskIds = inferTaskIdsFromStagedFiles(stagedFiles);
    const findings = [];
    if (!actorId && !taskId && !sessionId) {
        if (stagedTaskIds.length > 0) {
            const wrapperRequired = {
                code: 'ATM_GIT_COMMIT_WRAPPER_REQUIRED',
                source: 'commit-attribution',
                detail: 'Staged ATM task/evidence changes must commit through node atm.mjs git commit so ATM can bind author, session, claim, and trailers consistently.',
                requiredCommand: `node atm.mjs git commit --actor <id> --task ${stagedTaskIds[0]} --message "<summary>" --json`,
                classification: 'current-task'
            };
            return {
                ok: false,
                findings: [wrapperRequired]
            };
        }
        return {
            ok: true,
            findings
        };
    }
    const effectiveTaskId = taskId ?? (stagedTaskIds.length === 1 ? stagedTaskIds[0] : null);
    if (!actorId || (stagedTaskIds.length > 0 && !effectiveTaskId)) {
        findings.push({
            code: 'ATM_GIT_COMMIT_WRAPPER_REQUIRED',
            source: 'commit-attribution',
            detail: 'Governed task commits must use node atm.mjs git commit --actor <id> --task <task> --message "<summary>" so ATM can bind author, session, claim, and trailers consistently.',
            requiredCommand: 'node atm.mjs git commit --actor <id> --task <task> --message "<summary>" --json',
            classification: 'current-task'
        });
        return {
            ok: false,
            findings
        };
    }
    if (!effectiveTaskId) {
        const expectedIdentity = resolveExpectedGitIdentityForActor(cwd, actorId);
        const authorName = normalizeOptionalText(process.env.GIT_AUTHOR_NAME) ?? runGitScalar(cwd, ['config', '--local', '--get', 'user.name']);
        const authorEmail = normalizeOptionalText(process.env.GIT_AUTHOR_EMAIL) ?? runGitScalar(cwd, ['config', '--local', '--get', 'user.email']);
        if (!expectedIdentity.gitName || !expectedIdentity.gitEmail) {
            findings.push({
                code: 'ATM_COMMIT_IDENTITY_PROFILE_MISSING',
                source: 'commit-attribution',
                detail: `Actor ${actorId} has no resolved git identity profile in actor registry or .atm/runtime/identity/default.json.`,
                requiredCommand: buildIdentitySetRequiredCommand(cwd, actorId),
                classification: 'current-task'
            });
        }
        else {
            if (authorName !== expectedIdentity.gitName) {
                findings.push({
                    code: 'ATM_COMMIT_AUTHOR_NAME_MISMATCH',
                    source: 'commit-attribution',
                    detail: `Commit author name is ${authorName ?? 'unset'}, expected ${expectedIdentity.gitName}.`,
                    classification: 'current-task'
                });
            }
            if (authorEmail !== expectedIdentity.gitEmail) {
                findings.push({
                    code: 'ATM_COMMIT_AUTHOR_EMAIL_MISMATCH',
                    source: 'commit-attribution',
                    detail: `Commit author email is ${authorEmail ?? 'unset'}, expected ${expectedIdentity.gitEmail}.`,
                    classification: 'current-task'
                });
            }
        }
        return {
            ok: findings.length === 0,
            findings
        };
    }
    const task = readJsonFile(path.join(cwd, '.atm', 'history', 'tasks', `${effectiveTaskId}.json`));
    const claim = parseHookTaskClaim(task?.claim);
    const mirrorSyncOnly = inspectMirrorSyncOnlyStagedArtifacts(cwd, effectiveTaskId, stagedFiles);
    const historicalLedgerRestore = inspectHistoricalLedgerRestoreStagedArtifacts(cwd, effectiveTaskId, stagedFiles);
    const bypassesActiveSession = mirrorSyncOnly.ok || historicalLedgerRestore.ok;
    const claimForSession = bypassesActiveSession ? null : claim;
    const session = bypassesActiveSession && !sessionId ? null : resolveActorWorkSession(cwd, {
        sessionId,
        actorId,
        taskId: effectiveTaskId,
        claimLeaseId: claimLeaseId ?? claimForSession?.leaseId ?? null,
        includeNonActive: true
    });
    if (!session && !bypassesActiveSession) {
        findings.push({
            code: 'ATM_COMMIT_SESSION_MISSING',
            source: 'commit-attribution',
            detail: `No ATM work session matched actor ${actorId} and task ${effectiveTaskId}. Claim the task through ATM before committing.`,
            requiredCommand: `node atm.mjs next --claim --actor ${actorId} --prompt "${effectiveTaskId}" --json`,
            classification: 'current-task'
        });
        return {
            ok: false,
            findings
        };
    }
    if (session && session.actorId !== actorId) {
        findings.push({
            code: 'ATM_COMMIT_SESSION_ACTOR_MISMATCH',
            source: 'commit-attribution',
            detail: `Session ${session.sessionId} belongs to ${session.actorId}, not ${actorId}.`,
            classification: 'current-task'
        });
    }
    if (session && session.taskId !== effectiveTaskId) {
        findings.push({
            code: 'ATM_COMMIT_SESSION_TASK_MISMATCH',
            source: 'commit-attribution',
            detail: `Session ${session.sessionId} is for ${session.taskId}, not ${effectiveTaskId}.`,
            classification: 'current-task'
        });
    }
    if (session && (claimLeaseId ?? claimForSession?.leaseId ?? null) && session.claimLeaseId !== (claimLeaseId ?? claimForSession?.leaseId ?? null)) {
        findings.push({
            code: 'ATM_COMMIT_SESSION_CLAIM_MISMATCH',
            source: 'commit-attribution',
            detail: `Session ${session.sessionId} is bound to claim ${session.claimLeaseId ?? 'unset'}, not ${(claimLeaseId ?? claimForSession?.leaseId) ?? 'unset'}.`,
            classification: 'current-task'
        });
    }
    const expectedIdentity = resolveExpectedGitIdentityForActor(cwd, actorId);
    const authorName = normalizeOptionalText(process.env.GIT_AUTHOR_NAME) ?? runGitScalar(cwd, ['config', '--local', '--get', 'user.name']);
    const authorEmail = normalizeOptionalText(process.env.GIT_AUTHOR_EMAIL) ?? runGitScalar(cwd, ['config', '--local', '--get', 'user.email']);
    if (!expectedIdentity.gitName || !expectedIdentity.gitEmail) {
        findings.push({
            code: 'ATM_COMMIT_IDENTITY_PROFILE_MISSING',
            source: 'commit-attribution',
            detail: `Actor ${actorId} has no resolved git identity profile in actor registry or .atm/runtime/identity/default.json.`,
            requiredCommand: buildIdentitySetRequiredCommand(cwd, actorId),
            classification: 'current-task'
        });
    }
    else {
        if (authorName !== expectedIdentity.gitName) {
            findings.push({
                code: 'ATM_COMMIT_AUTHOR_NAME_MISMATCH',
                source: 'commit-attribution',
                detail: `Commit author name is ${authorName ?? 'unset'}, expected ${expectedIdentity.gitName}.`,
                classification: 'current-task'
            });
        }
        if (authorEmail !== expectedIdentity.gitEmail) {
            findings.push({
                code: 'ATM_COMMIT_AUTHOR_EMAIL_MISMATCH',
                source: 'commit-attribution',
                detail: `Commit author email is ${authorEmail ?? 'unset'}, expected ${expectedIdentity.gitEmail}.`,
                classification: 'current-task'
            });
        }
    }
    return {
        ok: findings.length === 0,
        findings
    };
}
function isStaticEvidenceArtifactPath(value) {
    const normalized = normalizeRelativePath(value).toLowerCase();
    if (normalized.startsWith('atomic_workbench/evidence/') && normalized.endsWith('.json')) {
        return true;
    }
    if (normalized.startsWith('atomic_workbench/reports/') && normalized.endsWith('.json')) {
        return true;
    }
    return false;
}
function isProtectedAtmRuntimeStatePath(value) {
    const normalized = normalizeRelativePath(value).toLowerCase();
    return normalized.startsWith('.atm/runtime/locks/')
        || normalized.startsWith('.atm/runtime/task-direction-locks/')
        || normalized.startsWith('.atm/runtime/task-queues/')
        || normalized.startsWith('.atm/runtime/batch-runs/')
        || normalized.startsWith('.atm/runtime/sessions/')
        || normalized.startsWith('.atm/runtime/identity/')
        || normalized === '.atm/runtime/current-task.json'
        || normalized === '.atm/runtime/guidance/active-session.json';
}
function readJsonFile(filePath) {
    if (!existsSync(filePath))
        return null;
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    }
    catch {
        return null;
    }
}
function inferTaskIdsFromStagedFiles(stagedFiles) {
    const taskIds = new Set();
    for (const file of stagedFiles) {
        const normalized = normalizeRelativePath(file);
        const taskMatch = normalized.match(/^\.atm\/history\/tasks\/([^/]+)\.json$/i);
        if (taskMatch) {
            taskIds.add(taskMatch[1]);
            continue;
        }
        const closurePacketMatch = normalized.match(/^\.atm\/history\/evidence\/([^/]+)\.closure-packet\.json$/i);
        if (closurePacketMatch) {
            taskIds.add(closurePacketMatch[1]);
            continue;
        }
        const evidenceMatch = normalized.match(/^\.atm\/history\/evidence\/([^/]+)\.json$/i);
        if (evidenceMatch) {
            taskIds.add(evidenceMatch[1]);
            continue;
        }
        const eventMatch = normalized.match(/^\.atm\/history\/task-events\/([^/]+)\//i);
        if (eventMatch) {
            taskIds.add(eventMatch[1]);
        }
    }
    return [...taskIds].sort((left, right) => left.localeCompare(right));
}
function inspectMirrorSyncOnlyStagedArtifacts(cwd, taskId, stagedFiles) {
    if (stagedFiles.length === 0) {
        return { ok: false, reason: 'no-staged-files' };
    }
    const expectedTaskPath = `.atm/history/tasks/${taskId}.json`.toLowerCase();
    let hasTaskLedger = false;
    let hasImportEvent = false;
    let hasImportReport = false;
    for (const file of stagedFiles) {
        const normalized = normalizeRelativePath(file);
        const lower = normalized.toLowerCase();
        if (lower === expectedTaskPath) {
            hasTaskLedger = true;
            continue;
        }
        if (lower.startsWith(`.atm/history/task-events/${taskId.toLowerCase()}/`) && lower.includes('import') && lower.endsWith('.json')) {
            hasImportEvent = true;
            continue;
        }
        if (lower.startsWith('.atm/history/reports/task-import/') && lower.endsWith('.json') && taskImportReportReferencesTask(cwd, normalized, taskId)) {
            hasImportReport = true;
            continue;
        }
        return { ok: false, reason: `unexpected-staged-file:${normalized}` };
    }
    return {
        ok: hasTaskLedger && hasImportEvent && hasImportReport,
        reason: hasTaskLedger && hasImportEvent && hasImportReport ? null : 'incomplete-mirror-sync-artifacts'
    };
}
function inspectHistoricalLedgerRestoreStagedArtifacts(cwd, taskId, stagedFiles) {
    if (stagedFiles.length === 0) {
        return { ok: false, reason: 'no-staged-files' };
    }
    const normalizedTaskId = taskId.toLowerCase();
    const expectedTaskPath = `.atm/history/tasks/${taskId}.json`.toLowerCase();
    const expectedEvidencePath = `.atm/history/evidence/${taskId}.json`.toLowerCase();
    const expectedClosurePacketPath = `.atm/history/evidence/${taskId}.closure-packet.json`.toLowerCase();
    let hasTaskLedger = false;
    let hasEvidenceBundle = false;
    let hasClosurePacket = false;
    let hasTaskEvent = false;
    for (const file of stagedFiles) {
        const normalized = normalizeRelativePath(file);
        const lower = normalized.toLowerCase();
        if (lower === expectedTaskPath) {
            hasTaskLedger = true;
            continue;
        }
        if (lower === expectedEvidencePath) {
            hasEvidenceBundle = true;
            continue;
        }
        if (lower === expectedClosurePacketPath) {
            hasClosurePacket = true;
            continue;
        }
        if (lower.startsWith(`.atm/history/task-events/${normalizedTaskId}/`) && lower.endsWith('.json')) {
            hasTaskEvent = true;
            continue;
        }
        return { ok: false, reason: `unexpected-staged-file:${normalized}` };
    }
    if (!hasTaskLedger)
        return { ok: false, reason: 'missing-task-ledger' };
    if (!hasEvidenceBundle)
        return { ok: false, reason: 'missing-evidence-bundle' };
    if (!hasClosurePacket)
        return { ok: false, reason: 'missing-closure-packet' };
    if (!hasTaskEvent)
        return { ok: false, reason: 'missing-task-event' };
    const taskDocument = readStagedJsonFile(cwd, `.atm/history/tasks/${taskId}.json`);
    if (!taskDocument || taskDocument.status !== 'done')
        return { ok: false, reason: 'task-not-done' };
    if (typeof taskDocument.workItemId === 'string' && taskDocument.workItemId !== taskId) {
        return { ok: false, reason: 'task-id-mismatch' };
    }
    const evidence = readStagedJsonFile(cwd, `.atm/history/evidence/${taskId}.json`);
    if (!evidence || evidence.taskId !== taskId) {
        return { ok: false, reason: 'evidence-task-id-mismatch' };
    }
    const closurePacket = readStagedJsonFile(cwd, `.atm/history/evidence/${taskId}.closure-packet.json`);
    if (!closurePacket || closurePacket.taskId !== taskId) {
        return { ok: false, reason: 'closure-packet-task-id-mismatch' };
    }
    for (const eventPath of stagedFiles.filter((file) => normalizeRelativePath(file).toLowerCase().startsWith(`.atm/history/task-events/${normalizedTaskId}/`))) {
        const event = readStagedJsonFile(cwd, eventPath);
        const command = typeof event?.command === 'string' ? event.command.trim() : '';
        if (!event || event.schemaId !== 'atm.taskTransition.v1' || event.taskId !== taskId || typeof event.transitionId !== 'string' || !command.startsWith('node atm.mjs ')) {
            return { ok: false, reason: `task-event-invalid:${normalizeRelativePath(eventPath)}` };
        }
    }
    return { ok: true, reason: null };
}
function readStagedJsonFile(cwd, relativeFile) {
    const result = runGit(cwd, ['show', `:${normalizeRelativePath(relativeFile)}`]);
    if (result.exitCode !== 0)
        return null;
    return readJsonText(result.stdout);
}
function taskImportReportReferencesTask(cwd, file, taskId) {
    try {
        const content = readFileSync(path.join(cwd, file), 'utf8');
        const parsed = JSON.parse(content);
        return JSON.stringify(parsed).includes(`"${taskId}"`);
    }
    catch {
        return false;
    }
}
function parseHookTaskClaim(value) {
    if (!isPlainObject(value))
        return null;
    const actorId = normalizeOptionalText(value.actorId);
    const leaseId = normalizeOptionalText(value.leaseId);
    return actorId && leaseId ? { actorId, leaseId } : null;
}
function resolveExpectedGitIdentityForActor(cwd, actorId) {
    const actorRecord = findActorByResolvedId(cwd, { actorId, source: 'option' });
    const defaultIdentity = readRuntimeIdentityDefault(cwd);
    const defaultMatches = defaultIdentity?.actorId === actorId;
    return {
        gitName: actorRecord?.gitName ?? (defaultMatches ? defaultIdentity?.gitName ?? null : null),
        gitEmail: actorRecord?.gitEmail ?? (defaultMatches ? defaultIdentity?.gitEmail ?? null : null)
    };
}
function buildIdentitySetRequiredCommand(cwd, actorId) {
    const gitName = runGitScalar(cwd, ['config', '--local', '--get', 'user.name']) ?? '<git user.name>';
    const gitEmail = runGitScalar(cwd, ['config', '--local', '--get', 'user.email']) ?? '<git user.email>';
    return `node atm.mjs identity set --actor ${quoteCliValue(actorId)} --git-name ${quoteCliValue(gitName)} --git-email ${quoteCliValue(gitEmail)} --json`;
}
function isPathAllowedByTaskDirection(filePath, allowedFiles) {
    const normalizedFile = normalizeRelativePath(filePath).toLowerCase();
    const cwd = process.cwd();
    return allowedFiles.some((candidate) => {
        let relCandidate = candidate;
        if (path.isAbsolute(candidate)) {
            relCandidate = relativePathFrom(cwd, candidate);
        }
        return matchesTaskDirectionPath(normalizedFile, normalizeRelativePath(relCandidate).toLowerCase());
    });
}
function matchesTaskDirectionPath(filePath, allowedPath) {
    if (!allowedPath)
        return false;
    if (allowedPath.includes('*')) {
        const pattern = allowedPath
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '::DOUBLE_STAR::')
            .replace(/\*/g, '[^/]*')
            .replace(/::DOUBLE_STAR::/g, '.*');
        return new RegExp(`^${pattern}$`, 'i').test(filePath);
    }
    if (filePath === allowedPath)
        return true;
    if (allowedPath.endsWith('/'))
        return filePath.startsWith(allowedPath);
    const allowedPathHasExtension = /\.[a-z0-9]+$/i.test(allowedPath);
    return !allowedPathHasExtension && filePath.startsWith(`${allowedPath}/`);
}
function normalizeRelativePath(value) {
    return String(value).replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
function sameStringSet(left, right) {
    const normalize = (values) => [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].sort();
    return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
function requireValue(argv, index, flag) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `hook command requires a value for ${flag}`, { exitCode: 2 });
    }
    return value;
}
