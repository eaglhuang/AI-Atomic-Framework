import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { actorIdEnvVar, findActorByResolvedId, readRuntimeIdentityDefault, resolveActorId, writeRuntimeIdentityDefault } from './actor-registry.js';
import { resolveActorWorkSession } from './actor-session.js';
import { findCloseCommitWindowCoveringPaths } from './framework-development.js';
import { getCanonicalAllowedFilesForTask, sanitizeTaskDirectionAllowedFiles } from './task-direction.js';
import { extractTaskDeclaredFiles } from './tasks/task-import-validators.js';
import { assertEmergencyApproval, recordProtectedOverrideOutcome } from './emergency/gate.js';
import { buildProtectedOverrideRepairCandidate } from './emergency/protected-override-audit.js';
import { CliError, makeResult, message, quoteCliValue, relativePathFrom } from './shared.js';
export function resolveGitExecutable() {
    const configured = process.env.ATM_GIT_EXECUTABLE?.trim();
    if (configured && existsSync(configured)) {
        return configured;
    }
    if (process.platform === 'win32') {
        const windowsGit = 'C:\\Program Files\\Git\\cmd\\git.exe';
        if (existsSync(windowsGit)) {
            return windowsGit;
        }
    }
    return 'git';
}
function runGitCommand(cwd, args, stdio = ['ignore', 'pipe', 'ignore']) {
    return execFileSync(resolveGitExecutable(), args, {
        cwd,
        encoding: 'utf8',
        stdio
    });
}
export async function runAtmGit(argv) {
    const options = parseGitOptions(argv);
    if (options.action === 'prepare') {
        return runGitPrepare(options);
    }
    if (options.action === 'commit') {
        return runGitCommit(options);
    }
    const check = evaluateGitGovernanceCheck({
        cwd: options.cwd,
        actorInput: options.actorId,
        taskId: options.taskId,
        sessionId: options.sessionId,
        requireTrailers: options.checkTrailers
    });
    return makeResult({
        ok: check.ok,
        command: 'git',
        cwd: options.cwd,
        messages: [check.ok
                ? message('info', 'ATM_GIT_CHECK_OK', 'Git governance checks passed.')
                : message('error', 'ATM_GIT_CHECK_FAILED', 'Git governance checks failed.', {
                    violations: check.violations
                })],
        evidence: {
            action: 'check',
            requiredTrailers: options.checkTrailers,
            actorId: check.actorId,
            taskId: check.taskId,
            claimLeaseId: check.claimLeaseId,
            sessionId: check.sessionId,
            git: {
                name: check.gitName,
                email: check.gitEmail
            },
            trailers: check.trailers,
            violations: check.violations
        }
    });
}
export function evaluateGitGovernanceCheck(input) {
    const cwd = path.resolve(input.cwd);
    const resolvedActor = resolveActorId(input.actorInput ?? undefined, cwd);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', `git check requires --actor or ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    const actorRecord = findActorByResolvedId(cwd, resolvedActor);
    const profile = resolveGitIdentityProfile(cwd, actorId, actorRecord);
    const gitName = readGitConfig(cwd, 'user.name');
    const gitEmail = readGitConfig(cwd, 'user.email');
    const taskDocument = input.taskId ? readTaskDocument(cwd, input.taskId) : null;
    const claim = taskDocument ? parseTaskClaim(taskDocument.claim) : null;
    const stagedMirrorSync = input.taskId ? inspectMirrorSyncOnlyStagedArtifacts(cwd, input.taskId) : null;
    const stagedHistoricalRestore = input.taskId ? inspectHistoricalLedgerRestoreStagedArtifacts(cwd, input.taskId) : null;
    const stagedCloseCommitWindow = input.taskId ? inspectCloseCommitWindowStagedArtifacts(cwd, input.taskId) : null;
    const bypassesActiveSession = stagedMirrorSync?.ok || stagedHistoricalRestore?.ok || stagedCloseCommitWindow?.ok;
    const claimForTrailers = bypassesActiveSession ? null : claim;
    const session = resolveGitGovernanceSession(cwd, {
        sessionId: input.sessionId ?? null,
        actorId,
        taskId: input.taskId,
        claimLeaseId: claimForTrailers?.leaseId ?? null,
        allowImplicitSession: Boolean(input.taskId && !bypassesActiveSession)
    });
    const trailers = parseTrailers(readHeadCommitMessage(cwd));
    const violations = [];
    if (!profile.gitName || !profile.gitEmail) {
        violations.push({
            code: 'git-identity-profile-missing',
            detail: `Actor ${actorId} has no resolved git identity profile in actor registry or .atm/runtime/identity/default.json.`
        });
    }
    if (profile.gitName && gitName !== profile.gitName) {
        violations.push({
            code: 'git-name-mismatch',
            detail: `git user.name is ${gitName ?? 'unset'}, expected ${profile.gitName}.`
        });
    }
    if (profile.gitEmail && gitEmail !== profile.gitEmail) {
        violations.push({
            code: 'git-email-mismatch',
            detail: `git user.email is ${gitEmail ?? 'unset'}, expected ${profile.gitEmail}.`
        });
    }
    if (!stagedHistoricalRestore?.ok && taskDocument && taskDocument.owner && String(taskDocument.owner) !== actorId) {
        violations.push({
            code: 'task-owner-mismatch',
            detail: `Task owner is ${String(taskDocument.owner)}, not ${actorId}.`
        });
    }
    if (!stagedHistoricalRestore?.ok && claim && claim.state === 'active' && claim.actorId !== actorId) {
        violations.push({
            code: 'claim-owner-mismatch',
            detail: `Task claim owner is ${claim.actorId}, not ${actorId}.`
        });
    }
    if (session && session.actorId !== actorId) {
        violations.push({
            code: 'session-actor-mismatch',
            detail: `Active session ${session.sessionId} belongs to ${session.actorId}, not ${actorId}.`
        });
    }
    if (session && input.taskId && session.taskId !== input.taskId) {
        violations.push({
            code: 'session-task-mismatch',
            detail: `Active session ${session.sessionId} is for ${session.taskId}, not ${input.taskId}.`
        });
    }
    if (session && claim?.leaseId && session.claimLeaseId && session.claimLeaseId !== claim.leaseId) {
        violations.push({
            code: 'session-claim-mismatch',
            detail: `Active session ${session.sessionId} is bound to claim ${session.claimLeaseId}, not ${claim.leaseId}.`
        });
    }
    if (input.requireTrailers) {
        requireTrailerValue(trailers, 'ATM-Actor', actorId, violations, 'trailer-actor-missing');
        if (input.taskId) {
            requireTrailerValue(trailers, 'ATM-Task', input.taskId, violations, 'trailer-task-missing');
        }
        if (claimForTrailers?.leaseId) {
            requireTrailerValue(trailers, 'ATM-Claim', claimForTrailers.leaseId, violations, 'trailer-claim-missing');
        }
        if (session?.sessionId) {
            requireTrailerValue(trailers, 'ATM-Session', session.sessionId, violations, 'trailer-session-missing');
        }
    }
    return {
        ok: violations.length === 0,
        actorId,
        taskId: input.taskId,
        claimLeaseId: claimForTrailers?.leaseId ?? null,
        sessionId: session?.sessionId ?? null,
        gitName,
        gitEmail,
        trailers,
        violations
    };
}
function runGitPrepare(options) {
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', `git prepare requires --actor or ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    const actorRecord = findActorByResolvedId(options.cwd, resolvedActor);
    const profile = resolveGitIdentityProfile(options.cwd, actorId, actorRecord);
    const nextName = options.gitName ?? profile.gitName ?? null;
    const nextEmail = options.gitEmail ?? profile.gitEmail ?? null;
    if (!nextName || !nextEmail) {
        throw new CliError('ATM_GIT_PREPARE_IDENTITY_MISSING', 'git prepare requires git name/email from actor registry, repo default identity, or explicit --name/--email.', {
            exitCode: 2,
            details: { actorId }
        });
    }
    writeGitConfig(options.cwd, 'user.name', nextName);
    writeGitConfig(options.cwd, 'user.email', nextEmail);
    const identityPath = options.gitName !== null && options.gitEmail !== null
        ? writePreparedRuntimeIdentity(options.cwd, actorId, nextName, nextEmail, actorRecord)
        : null;
    const taskDocument = options.taskId ? readTaskDocument(options.cwd, options.taskId) : null;
    const claim = taskDocument ? parseTaskClaim(taskDocument.claim) : null;
    const session = resolveGitGovernanceSession(options.cwd, {
        sessionId: options.sessionId ?? null,
        actorId,
        taskId: options.taskId,
        claimLeaseId: claim?.leaseId ?? null,
        allowImplicitSession: Boolean(options.taskId)
    });
    const trailerHints = [
        `ATM-Actor: ${actorId}`,
        ...(options.taskId ? [`ATM-Task: ${options.taskId}`] : []),
        ...(claim?.leaseId ? [`ATM-Claim: ${claim.leaseId}`] : []),
        ...(session?.sessionId ? [`ATM-Session: ${session.sessionId}`] : []),
        ...(options.taskId ? [`ATM-Evidence: .atm/history/evidence/${options.taskId}.json`] : [])
    ];
    return makeResult({
        ok: true,
        command: 'git',
        cwd: options.cwd,
        messages: [message('info', 'ATM_GIT_PREPARED', 'Repo-local git identity has been prepared for the resolved actor.', {
                actorId,
                gitName: nextName,
                gitEmail: nextEmail,
                runtimeIdentityPath: identityPath
            })],
        evidence: {
            action: 'prepare',
            actorId,
            identityPath,
            sessionId: session?.sessionId ?? null,
            git: {
                name: nextName,
                email: nextEmail
            },
            trailerHints
        }
    });
}
function runGitCommit(options) {
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', `git commit requires --actor or ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
    }
    if (!options.message) {
        throw new CliError('ATM_CLI_USAGE', 'git commit requires --message <summary>.', { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    const commitCommand = `node atm.mjs git commit --actor ${actorId}${options.taskId ? ` --task ${options.taskId}` : ''} --message ${quoteCliValue(options.message)}${options.noVerify ? ' --no-verify' : ''} --json`;
    let protectedOverrideAudit = null;
    if (options.noVerify) {
        protectedOverrideAudit = assertEmergencyApproval({
            cwd: options.cwd,
            surface: 'git commit --no-verify',
            permission: 'backend.gitHookBypass',
            taskId: options.taskId,
            actorId,
            emergencyApproval: options.emergencyApproval,
            flags: ['--no-verify'],
            reason: options.overrideReason ?? 'Governed git hook bypass for emergency recovery.',
            command: commitCommand
        });
    }
    const actorRecord = findActorByResolvedId(options.cwd, resolvedActor);
    const profile = resolveGitIdentityProfile(options.cwd, actorId, actorRecord);
    if (!profile.gitName || !profile.gitEmail) {
        throw new CliError('ATM_GIT_COMMIT_IDENTITY_MISSING', 'git commit requires a resolved git identity profile. Run identity set or actor register first.', {
            exitCode: 2,
            details: {
                actorId,
                requiredCommand: buildIdentitySetRequiredCommand(options.cwd, actorId)
            }
        });
    }
    const taskDocument = options.taskId ? readTaskDocument(options.cwd, options.taskId) : null;
    const claim = taskDocument ? parseTaskClaim(taskDocument.claim) : null;
    const stagedMirrorSync = options.taskId ? inspectMirrorSyncOnlyStagedArtifacts(options.cwd, options.taskId) : null;
    const stagedHistoricalRestore = options.taskId ? inspectHistoricalLedgerRestoreStagedArtifacts(options.cwd, options.taskId) : null;
    const stagedCloseCommitWindow = options.taskId ? inspectCloseCommitWindowStagedArtifacts(options.cwd, options.taskId) : null;
    const bypassesActiveSession = stagedMirrorSync?.ok || stagedHistoricalRestore?.ok || stagedCloseCommitWindow?.ok;
    const claimForTrailers = bypassesActiveSession ? null : claim;
    const session = resolveGitGovernanceSession(options.cwd, {
        sessionId: options.sessionId ?? null,
        actorId,
        taskId: options.taskId,
        claimLeaseId: claimForTrailers?.leaseId ?? null,
        allowImplicitSession: Boolean(options.taskId && !bypassesActiveSession)
    });
    if (options.taskId && !session && !bypassesActiveSession) {
        throw new CliError('ATM_GIT_COMMIT_SESSION_REQUIRED', `git commit requires an active or recent ATM work session for ${options.taskId}.`, {
            exitCode: 1,
            details: {
                actorId,
                taskId: options.taskId,
                requiredCommand: `node atm.mjs next --claim --actor ${actorId} --prompt "${options.taskId}" --json`
            }
        });
    }
    if (options.taskId && taskDocument && !bypassesActiveSession) {
        const bundleReport = resolveTaskScopedCommitBundle({
            cwd: options.cwd,
            taskId: options.taskId,
            taskDocument,
            apply: !options.dryRun && (options.autoStage || options.deferForeignStaged),
            autoStage: options.autoStage,
            deferForeignStaged: options.deferForeignStaged,
            message: options.message,
            actorId,
            trailers: [
                `ATM-Actor: ${actorId}`,
                `ATM-Task: ${options.taskId}`,
                ...(claimForTrailers?.leaseId ? [`ATM-Claim: ${claimForTrailers.leaseId}`] : []),
                ...(session?.sessionId ? [`ATM-Session: ${session.sessionId}`] : [])
            ]
        });
        const copyableCommitCommand = bundleReport.copyableCommitCommand;
        if (options.dryRun) {
            return makeResult({
                ok: bundleReport.ok,
                command: 'git',
                cwd: options.cwd,
                messages: [bundleReport.ok
                        ? message('info', 'ATM_GIT_COMMIT_BUNDLE_DRY_RUN', `git commit dry-run for ${options.taskId} resolved a task-scoped bundle without mutating the index.`, {
                            taskId: options.taskId,
                            stageFiles: bundleReport.stageFiles,
                            skippedExternalDirtyFiles: bundleReport.skippedExternalDirtyFiles
                        })
                        : message('error', bundleReport.blockedCode ?? 'ATM_GIT_COMMIT_BUNDLE_BLOCKED', bundleReport.blockedSummary ?? 'Task-scoped commit bundle resolver blocked the commit.', {
                            commitBundle: bundleReport
                        })],
                evidence: {
                    action: 'commit',
                    dryRun: true,
                    actorId,
                    taskId: options.taskId,
                    sessionId: session?.sessionId ?? null,
                    commitBundle: bundleReport,
                    copyableCommitCommand
                }
            });
        }
        if (!bundleReport.ok) {
            throw new CliError(bundleReport.blockedCode ?? 'ATM_GIT_COMMIT_BUNDLE_BLOCKED', bundleReport.blockedSummary ?? 'Task-scoped commit bundle resolver blocked the commit.', {
                exitCode: 1,
                details: {
                    actorId,
                    taskId: options.taskId,
                    sessionId: session?.sessionId ?? null,
                    commitBundle: bundleReport,
                    copyableCommitCommand,
                    unexpectedStagedTasks: bundleReport.unexpectedStagedTasks,
                    skippedExternalDirtyFiles: bundleReport.skippedExternalDirtyFiles
                }
            });
        }
        const stagedBundleInspection = inspectTaskScopedStagedGovernanceBundle(options.cwd, options.taskId, taskDocument);
        if (!stagedBundleInspection.ok) {
            throw new CliError(stagedBundleInspection.code, stagedBundleInspection.summary, {
                exitCode: 1,
                details: {
                    actorId,
                    taskId: options.taskId,
                    sessionId: session?.sessionId ?? null,
                    ...stagedBundleInspection.details,
                    copyableCommitCommand,
                    governanceBundleWarnings: stagedBundleInspection.warnings
                }
            });
        }
        const stagingInspection = inspectTaskScopedUnstagedCommit(options.cwd, options.taskId, taskDocument);
        if (stagingInspection?.kind === 'staging-required') {
            throw new CliError('ATM_GIT_COMMIT_TASK_SCOPED_STAGING_REQUIRED', `git commit for ${options.taskId} requires staged task-scoped files before the wrapper can create a governed commit.`, {
                exitCode: 1,
                details: {
                    actorId,
                    taskId: options.taskId,
                    sessionId: session?.sessionId ?? null,
                    inScopeDirtyFiles: stagingInspection.inScopeDirtyFiles,
                    skippedExternalDirtyFiles: stagingInspection.skippedExternalDirtyFiles,
                    requiredCommand: stagingInspection.requiredCommand,
                    autoStageCommand: `node atm.mjs git commit --actor ${quoteCliValue(actorId)} --task ${quoteCliValue(options.taskId)} --message ${quoteCliValue(options.message)} --auto-stage --json`,
                    copyableCommitCommand
                }
            });
        }
        if (stagingInspection?.kind === 'mixed-scope') {
            throw new CliError('ATM_GIT_COMMIT_TASK_SCOPED_STAGING_AMBIGUOUS', `git commit for ${options.taskId} found out-of-scope files already staged with task-scoped work; defer foreign staged files or stage only in-scope files manually before retrying.`, {
                exitCode: 1,
                details: {
                    actorId,
                    taskId: options.taskId,
                    sessionId: session?.sessionId ?? null,
                    inScopeDirtyFiles: stagingInspection.inScopeDirtyFiles,
                    outOfScopeStagedFiles: stagingInspection.outOfScopeStagedFiles,
                    deferForeignStagedCommand: `node atm.mjs git commit --actor ${quoteCliValue(actorId)} --task ${quoteCliValue(options.taskId)} --message ${quoteCliValue(options.message)} --defer-foreign-staged --json`,
                    copyableCommitCommand
                }
            });
        }
    }
    const trailers = [
        `ATM-Actor: ${actorId}`,
        ...(options.taskId ? [`ATM-Task: ${options.taskId}`] : []),
        ...(claimForTrailers?.leaseId ? [`ATM-Claim: ${claimForTrailers.leaseId}`] : []),
        ...(session?.sessionId ? [`ATM-Session: ${session.sessionId}`] : [])
    ];
    const args = [
        'commit',
        ...(options.noVerify ? ['--no-verify'] : []),
        '--message',
        options.message,
        '--message',
        trailers.join('\n')
    ];
    let protectedOverrideOutcome = null;
    try {
        execFileSync(resolveGitExecutable(), args, {
            cwd: options.cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                GIT_AUTHOR_NAME: profile.gitName,
                GIT_AUTHOR_EMAIL: profile.gitEmail,
                GIT_COMMITTER_NAME: profile.gitName,
                GIT_COMMITTER_EMAIL: profile.gitEmail,
                ATM_COMMIT_ACTOR_ID: actorId,
                ATM_COMMIT_TASK_ID: options.taskId ?? '',
                ATM_COMMIT_CLAIM_LEASE_ID: claimForTrailers?.leaseId ?? '',
                ATM_COMMIT_SESSION_ID: session?.sessionId ?? '',
                ATM_COMMIT_TRAILERS: trailers.join('\n')
            }
        });
    }
    catch (error) {
        if (protectedOverrideAudit?.protectedOverrideAudit?.event?.eventId) {
            protectedOverrideOutcome = recordProtectedOverrideOutcome({
                cwd: options.cwd,
                parentEventId: protectedOverrideAudit.protectedOverrideAudit.event.eventId,
                actorId,
                taskId: options.taskId,
                surface: 'git commit --no-verify',
                command: commitCommand,
                flags: ['--no-verify'],
                permission: 'backend.gitHookBypass',
                leaseId: options.emergencyApproval,
                reason: options.overrideReason ?? 'Governed git hook bypass for emergency recovery.',
                skippedChecks: ['pre-commit-hook', 'framework-development-gates'],
                touchedFiles: [],
                outcome: 'failed',
                failureCode: 'ATM_GIT_COMMIT_FAILED',
                emergencyUsePath: protectedOverrideAudit.usePath,
                repairCandidate: buildProtectedOverrideRepairCandidate({
                    summary: 'Git commit failed after an authorized hook bypass; fix the commit error and retry without --no-verify when hooks can pass.',
                    suggestedCommand: `node atm.mjs git commit --actor ${actorId}${options.taskId ? ` --task ${options.taskId}` : ''} --message ${quoteCliValue(options.message)} --json`,
                    deferredChecks: ['pre-commit-hook', 'framework-development-gates']
                })
            });
        }
        const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr ?? '') : '';
        const stdout = error instanceof Error && 'stdout' in error ? String(error.stdout ?? '') : '';
        throw new CliError('ATM_GIT_COMMIT_FAILED', 'ATM git commit wrapper failed.', {
            exitCode: 1,
            details: {
                actorId,
                taskId: options.taskId,
                sessionId: session?.sessionId ?? null,
                stdout,
                stderr,
                gitExecutable: resolveGitExecutable(),
                copyableCommitCommand: buildCopyableGitCommitCommand({
                    cwd: options.cwd,
                    message: options.message,
                    trailers,
                    noVerify: options.noVerify
                }),
                protectedOverrideOutcome
            }
        });
    }
    if (protectedOverrideAudit?.protectedOverrideAudit?.event?.eventId) {
        protectedOverrideOutcome = recordProtectedOverrideOutcome({
            cwd: options.cwd,
            parentEventId: protectedOverrideAudit.protectedOverrideAudit.event.eventId,
            actorId,
            taskId: options.taskId,
            surface: 'git commit --no-verify',
            command: commitCommand,
            flags: ['--no-verify'],
            permission: 'backend.gitHookBypass',
            leaseId: options.emergencyApproval,
            reason: options.overrideReason ?? 'Governed git hook bypass for emergency recovery.',
            skippedChecks: ['pre-commit-hook', 'framework-development-gates'],
            touchedFiles: [],
            outcome: 'succeeded',
            emergencyUsePath: protectedOverrideAudit.usePath,
            repairCandidate: buildProtectedOverrideRepairCandidate({
                summary: 'Hook bypass succeeded; schedule a follow-up commit that passes normal pre-commit governance when recovery is complete.',
                suggestedCommand: 'node atm.mjs doctor --json',
                deferredChecks: ['pre-commit-hook', 'framework-development-gates']
            })
        });
    }
    const commitSha = readHeadCommitSha(options.cwd);
    return makeResult({
        ok: true,
        command: 'git',
        cwd: options.cwd,
        messages: [message('info', 'ATM_GIT_COMMIT_OK', 'ATM git commit wrapper created a commit with governed author and trailers.', {
                actorId,
                taskId: options.taskId,
                sessionId: session?.sessionId ?? null,
                commitSha
            })],
        evidence: {
            action: 'commit',
            actorId,
            taskId: options.taskId,
            claimLeaseId: claimForTrailers?.leaseId ?? null,
            sessionId: session?.sessionId ?? null,
            commitSha,
            trailers,
            git: profile,
            gitExecutable: resolveGitExecutable(),
            copyableCommitCommand: buildCopyableGitCommitCommand({
                cwd: options.cwd,
                message: options.message,
                trailers,
                noVerify: options.noVerify
            }),
            protectedOverrideAudit: protectedOverrideAudit?.protectedOverrideAudit ?? null,
            protectedOverrideOutcome
        }
    });
}
function parseGitOptions(argv) {
    const options = {
        cwd: process.cwd(),
        action: null,
        actorId: null,
        taskId: null,
        gitName: null,
        gitEmail: null,
        sessionId: null,
        message: null,
        noVerify: false,
        emergencyApproval: null,
        overrideReason: null,
        checkTrailers: true,
        autoStage: false,
        deferForeignStaged: false,
        dryRun: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd') {
            options.cwd = requireValue(argv, index, '--cwd');
            index += 1;
            continue;
        }
        if (arg === '--actor') {
            options.actorId = requireValue(argv, index, '--actor');
            index += 1;
            continue;
        }
        if (arg === '--task') {
            options.taskId = requireValue(argv, index, '--task');
            index += 1;
            continue;
        }
        if (arg === '--name') {
            options.gitName = requireValue(argv, index, '--name');
            index += 1;
            continue;
        }
        if (arg === '--email') {
            options.gitEmail = requireValue(argv, index, '--email');
            index += 1;
            continue;
        }
        if (arg === '--session') {
            options.sessionId = requireValue(argv, index, '--session');
            index += 1;
            continue;
        }
        if (arg === '--message') {
            options.message = requireValue(argv, index, '--message');
            index += 1;
            continue;
        }
        if (arg === '--no-verify') {
            options.noVerify = true;
            continue;
        }
        if (arg === '--emergency-approval' || arg === '--lease') {
            options.emergencyApproval = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--reason') {
            options.overrideReason = requireValue(argv, index, '--reason');
            index += 1;
            continue;
        }
        if (arg === '--no-trailers') {
            options.checkTrailers = false;
            continue;
        }
        if (arg === '--auto-stage') {
            options.autoStage = true;
            continue;
        }
        if (arg === '--defer-foreign-staged') {
            options.deferForeignStaged = true;
            continue;
        }
        if (arg === '--dry-run') {
            options.dryRun = true;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        if (arg.startsWith('--')) {
            throw new CliError('ATM_CLI_USAGE', `git does not support option ${arg}`, { exitCode: 2 });
        }
        if (options.action) {
            throw new CliError('ATM_CLI_USAGE', 'git accepts only one action.', { exitCode: 2 });
        }
        if (arg !== 'prepare' && arg !== 'check' && arg !== 'commit') {
            throw new CliError('ATM_CLI_USAGE', 'git supports: prepare, check, commit', { exitCode: 2 });
        }
        options.action = arg;
    }
    if (!options.action) {
        throw new CliError('ATM_CLI_USAGE', 'git requires an action (prepare | check | commit).', { exitCode: 2 });
    }
    return {
        ...options,
        action: options.action,
        cwd: path.resolve(options.cwd)
    };
}
function resolveGitIdentityProfile(cwd, actorId, actorRecord) {
    const defaultIdentity = readRuntimeIdentityDefault(cwd);
    if (actorRecord?.gitName || actorRecord?.gitEmail) {
        const defaultMatches = defaultIdentity?.actorId === actorId;
        return {
            gitName: actorRecord.gitName ?? (defaultMatches ? defaultIdentity?.gitName ?? null : null),
            gitEmail: actorRecord.gitEmail ?? (defaultMatches ? defaultIdentity?.gitEmail ?? null : null)
        };
    }
    if (defaultIdentity?.actorId === actorId) {
        return {
            gitName: defaultIdentity.gitName ?? null,
            gitEmail: defaultIdentity.gitEmail ?? null
        };
    }
    return {
        gitName: null,
        gitEmail: null
    };
}
function writePreparedRuntimeIdentity(cwd, actorId, gitName, gitEmail, actorRecord) {
    const existing = readRuntimeIdentityDefault(cwd);
    const existingMatchesActor = existing?.actorId === actorId;
    return writeRuntimeIdentityDefault(cwd, {
        schemaId: 'atm.identityDefault.v1',
        specVersion: '0.1.0',
        actorId,
        gitName,
        gitEmail,
        editor: (existingMatchesActor ? existing?.editor : null) ?? actorRecord?.editor ?? null,
        provider: (existingMatchesActor ? existing?.provider : null) ?? actorRecord?.provider ?? null,
        activeSessionId: existingMatchesActor ? existing?.activeSessionId ?? null : null,
        updatedAt: new Date().toISOString()
    });
}
function buildIdentitySetRequiredCommand(cwd, actorId) {
    const gitName = readGitConfig(cwd, 'user.name') ?? '<git user.name>';
    const gitEmail = readGitConfig(cwd, 'user.email') ?? '<git user.email>';
    return `node atm.mjs identity set --actor ${quoteCliValue(actorId)} --git-name ${quoteCliValue(gitName)} --git-email ${quoteCliValue(gitEmail)} --json`;
}
function readTaskDocument(cwd, taskId) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(taskPath)) {
        throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${taskId}.`, {
            exitCode: 2,
            details: {
                taskId,
                taskPath: relativePathFrom(cwd, taskPath)
            }
        });
    }
    return JSON.parse(readFileSync(taskPath, 'utf8'));
}
function parseTaskClaim(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const candidate = value;
    const actorId = typeof candidate.actorId === 'string' ? candidate.actorId.trim() : '';
    const leaseId = typeof candidate.leaseId === 'string' ? candidate.leaseId.trim() : '';
    const stateRaw = typeof candidate.state === 'string' ? candidate.state.trim() : 'active';
    const state = stateRaw === 'released' || stateRaw === 'handoff' || stateRaw === 'taken_over' ? stateRaw : 'active';
    if (!actorId || !leaseId) {
        return null;
    }
    return { actorId, leaseId, state };
}
function resolveGitGovernanceSession(cwd, input) {
    if (!input.sessionId && !input.allowImplicitSession) {
        return null;
    }
    return resolveActorWorkSession(cwd, {
        sessionId: input.sessionId,
        actorId: input.actorId,
        taskId: input.taskId,
        claimLeaseId: input.claimLeaseId,
        includeNonActive: true
    });
}
function inspectMirrorSyncOnlyStagedArtifacts(cwd, taskId) {
    const stagedFiles = readStagedFiles(cwd);
    if (stagedFiles.length === 0) {
        return { ok: false, taskId, stagedFiles, reason: 'no-staged-files' };
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
        return { ok: false, taskId, stagedFiles, reason: `unexpected-staged-file:${normalized}` };
    }
    if (!hasTaskLedger)
        return { ok: false, taskId, stagedFiles, reason: 'missing-task-ledger' };
    if (!hasImportEvent)
        return { ok: false, taskId, stagedFiles, reason: 'missing-import-event' };
    if (!hasImportReport)
        return { ok: false, taskId, stagedFiles, reason: 'missing-task-import-report' };
    return { ok: true, taskId, stagedFiles, reason: null };
}
function inspectHistoricalLedgerRestoreStagedArtifacts(cwd, taskId) {
    const stagedFiles = readStagedFiles(cwd);
    if (stagedFiles.length === 0) {
        return { ok: false, taskId, stagedFiles, reason: 'no-staged-files' };
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
        return { ok: false, taskId, stagedFiles, reason: `unexpected-staged-file:${normalized}` };
    }
    if (!hasTaskLedger)
        return { ok: false, taskId, stagedFiles, reason: 'missing-task-ledger' };
    if (!hasEvidenceBundle)
        return { ok: false, taskId, stagedFiles, reason: 'missing-evidence-bundle' };
    if (!hasClosurePacket)
        return { ok: false, taskId, stagedFiles, reason: 'missing-closure-packet' };
    if (!hasTaskEvent)
        return { ok: false, taskId, stagedFiles, reason: 'missing-task-event' };
    const taskDocument = readStagedJsonFile(cwd, `.atm/history/tasks/${taskId}.json`);
    if (!taskDocument)
        return { ok: false, taskId, stagedFiles, reason: 'task-ledger-invalid' };
    if (taskDocument.status !== 'done')
        return { ok: false, taskId, stagedFiles, reason: 'task-not-done' };
    if (typeof taskDocument.workItemId === 'string' && taskDocument.workItemId !== taskId) {
        return { ok: false, taskId, stagedFiles, reason: 'task-id-mismatch' };
    }
    const evidence = readStagedJsonFile(cwd, `.atm/history/evidence/${taskId}.json`);
    if (!evidence || evidence.taskId !== taskId) {
        return { ok: false, taskId, stagedFiles, reason: 'evidence-task-id-mismatch' };
    }
    const closurePacket = readStagedJsonFile(cwd, `.atm/history/evidence/${taskId}.closure-packet.json`);
    if (!closurePacket || closurePacket.taskId !== taskId) {
        return { ok: false, taskId, stagedFiles, reason: 'closure-packet-task-id-mismatch' };
    }
    for (const eventPath of stagedFiles.filter((file) => normalizeRelativePath(file).toLowerCase().startsWith(`.atm/history/task-events/${normalizedTaskId}/`))) {
        const event = readStagedJsonFile(cwd, eventPath);
        const command = typeof event?.command === 'string' ? event.command.trim() : '';
        if (!event || event.schemaId !== 'atm.taskTransition.v1' || event.taskId !== taskId || typeof event.transitionId !== 'string' || !command.startsWith('node atm.mjs ')) {
            return { ok: false, taskId, stagedFiles, reason: `task-event-invalid:${normalizeRelativePath(eventPath)}` };
        }
    }
    return { ok: true, taskId, stagedFiles, reason: null };
}
function inspectCloseCommitWindowStagedArtifacts(cwd, taskId) {
    const stagedFiles = readStagedFiles(cwd);
    if (stagedFiles.length === 0) {
        return { ok: false, taskId, stagedFiles, reason: 'no-staged-files' };
    }
    const windowRecord = findCloseCommitWindowCoveringPaths(cwd, stagedFiles);
    if (!windowRecord) {
        return { ok: false, taskId, stagedFiles, reason: 'no-covering-window' };
    }
    if (windowRecord.taskId !== taskId) {
        return { ok: false, taskId, stagedFiles, reason: `window-task-mismatch:${windowRecord.taskId}` };
    }
    return { ok: true, taskId, stagedFiles, reason: null };
}
function readStagedJsonFile(cwd, relativeFile) {
    try {
        const content = execFileSync('git', ['show', `:${normalizeRelativePath(relativeFile)}`], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        const parsed = JSON.parse(content);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
function readStagedFiles(cwd) {
    try {
        return runGitCommand(cwd, ['diff', '--cached', '--name-only', '--diff-filter=ACMRT'])
            .split(/\r?\n/).map(normalizeRelativePath).filter(Boolean).sort((left, right) => left.localeCompare(right));
    }
    catch {
        return [];
    }
}
function readStagedDiffNames(cwd, diffFilter) {
    try {
        return runGitCommand(cwd, ['diff', '--cached', '--name-only', `--diff-filter=${diffFilter}`])
            .split(/\r?\n/).map(normalizeRelativePath).filter(Boolean);
    }
    catch {
        return [];
    }
}
function extractGovernanceTaskIdFromPath(filePath) {
    const normalized = normalizeRelativePath(filePath);
    if (!normalized.startsWith('.atm/history/'))
        return null;
    const tasksMatch = normalized.match(/^\.atm\/history\/tasks\/([^/]+)\.json$/i);
    if (tasksMatch)
        return tasksMatch[1].toUpperCase();
    const evidenceMatch = normalized.match(/^\.atm\/history\/evidence\/([^/.]+)(?:\.[^/]+)?$/i);
    if (evidenceMatch)
        return evidenceMatch[1].toUpperCase();
    const eventMatch = normalized.match(/^\.atm\/history\/task-events\/([^/]+)\//i);
    if (eventMatch)
        return eventMatch[1].toUpperCase();
    return null;
}
function isAllowedGovernanceArtifactPath(filePath, taskId) {
    const normalized = normalizeRelativePath(filePath);
    const normalizedTaskId = taskId.toLowerCase();
    const lower = normalized.toLowerCase();
    if (lower === `.atm/history/tasks/${normalizedTaskId}.json`)
        return true;
    if (lower === `.atm/history/evidence/${normalizedTaskId}.json`)
        return true;
    if (lower === `.atm/history/evidence/${normalizedTaskId}.closure-packet.json`)
        return true;
    if (lower.startsWith(`.atm/history/task-events/${normalizedTaskId}/`) && lower.endsWith('.json'))
        return true;
    return isIgnorableCommitStagingSideEffect(normalized, taskId);
}
function isFileAllowedInTaskBundle(filePath, taskId, declaredScope) {
    if (isAllowedGovernanceArtifactPath(filePath, taskId))
        return true;
    return declaredScope.some((scope) => pathMatchesTaskScope(filePath, scope));
}
function buildCopyableGitCommitCommand(input) {
    const cwdFlag = path.resolve(input.cwd) === path.resolve(process.cwd())
        ? ''
        : ` -C ${quoteCliValue(input.cwd)}`;
    const gitExecutable = quoteCliValue(resolveGitExecutable());
    const body = [input.message, ...input.trailers].join('\n\n');
    return `${gitExecutable}${cwdFlag} commit${input.noVerify ? ' --no-verify' : ''} -m ${quoteCliValue(input.message)} -m ${quoteCliValue(body)}`;
}
function buildUnexpectedStagedTasksForGitCommit(cwd, taskId, declaredScope, stagedFiles) {
    const grouped = new Map();
    for (const filePath of stagedFiles) {
        if (isFileAllowedInTaskBundle(filePath, taskId, declaredScope))
            continue;
        const foreignTaskId = extractGovernanceTaskIdFromPath(filePath);
        if (!foreignTaskId || foreignTaskId === taskId.toUpperCase())
            continue;
        const bucket = grouped.get(foreignTaskId) ?? [];
        bucket.push(filePath);
        grouped.set(foreignTaskId, bucket);
    }
    return [...grouped.entries()].map(([foreignTaskId, files]) => {
        const uniqueFiles = uniqueSorted(files);
        return {
            taskId: foreignTaskId,
            stagedFiles: uniqueFiles,
            restoreChoice: `Do not silently unstage ${foreignTaskId}. Either wait for that agent to commit, or defer foreign staged files through --defer-foreign-staged and confirm the other agent can restage afterward.`,
            deferCommand: `${quoteCliValue(resolveGitExecutable())} restore --staged -- ${uniqueFiles.map(quoteCliValue).join(' ')}`
        };
    });
}
function deferForeignStagedFiles(cwd, taskId, unexpectedStagedTasks) {
    if (unexpectedStagedTasks.length === 0)
        return null;
    const files = uniqueSorted(unexpectedStagedTasks.flatMap((entry) => entry.stagedFiles));
    const snapshotPath = `.atm/runtime/snapshots/foreign-staged-${taskId}-${Date.now()}.json`;
    mkdirSync(path.dirname(path.join(cwd, snapshotPath)), { recursive: true });
    writeFileSync(path.join(cwd, snapshotPath), `${JSON.stringify({
        schemaId: 'atm.foreignStagedSnapshot.v1',
        taskId,
        createdAt: new Date().toISOString(),
        files
    }, null, 2)}\n`, 'utf8');
    runGitCommand(cwd, ['restore', '--staged', '--', ...files], ['ignore', 'pipe', 'pipe']);
    return snapshotPath;
}
export function resolveTaskScopedCommitBundle(input) {
    const declaredScope = resolveTaskDeclaredScope(input.cwd, input.taskId, input.taskDocument);
    const gitExecutable = resolveGitExecutable();
    const copyableCommitCommand = buildCopyableGitCommitCommand({
        cwd: input.cwd,
        message: input.message,
        trailers: input.trailers
    });
    let stagedFiles = readStagedFiles(input.cwd);
    let unexpectedStagedTasks = buildUnexpectedStagedTasksForGitCommit(input.cwd, input.taskId, declaredScope, stagedFiles);
    let deferredForeignStagedSnapshot = null;
    if (input.deferForeignStaged && unexpectedStagedTasks.length > 0 && input.apply) {
        deferredForeignStagedSnapshot = deferForeignStagedFiles(input.cwd, input.taskId, unexpectedStagedTasks);
        stagedFiles = readStagedFiles(input.cwd);
        unexpectedStagedTasks = buildUnexpectedStagedTasksForGitCommit(input.cwd, input.taskId, declaredScope, stagedFiles);
    }
    const dirtyFiles = listTaskScopedWorktreeDirtyFiles(input.cwd);
    const stagedSet = new Set(stagedFiles);
    const unstagedDirtyFiles = dirtyFiles.filter((filePath) => !stagedSet.has(filePath));
    const inScopeUnstagedDirty = unstagedDirtyFiles.filter((filePath) => declaredScope.some((scope) => pathMatchesTaskScope(filePath, scope))
        || isAllowedGovernanceArtifactPath(filePath, input.taskId));
    const skippedExternalDirtyFiles = unstagedDirtyFiles.filter((filePath) => !declaredScope.some((scope) => pathMatchesTaskScope(filePath, scope))
        && !isIgnorableCommitStagingSideEffect(filePath, input.taskId));
    const outOfScopeStagedFiles = stagedFiles.filter((filePath) => !isFileAllowedInTaskBundle(filePath, input.taskId, declaredScope));
    const outOfScopeStagedDeletions = readStagedDiffNames(input.cwd, 'D').filter((filePath) => !isFileAllowedInTaskBundle(filePath, input.taskId, declaredScope));
    const governanceBundleWarnings = [];
    const stageCandidates = input.autoStage ? uniqueSorted(inScopeUnstagedDirty) : [];
    let blockedCode = null;
    let blockedSummary = null;
    if (unexpectedStagedTasks.length > 0 && !input.deferForeignStaged) {
        blockedCode = 'ATM_GIT_COMMIT_FOREIGN_STAGED_TASKS';
        blockedSummary = `git commit for ${input.taskId} found staged governance files for other tasks (${unexpectedStagedTasks.map((entry) => entry.taskId).join(', ')}). Use --defer-foreign-staged under a governed command or wait for the other agent to commit.`;
    }
    else if (outOfScopeStagedFiles.length > 0 || outOfScopeStagedDeletions.length > 0) {
        blockedCode = 'ATM_GIT_COMMIT_OUT_OF_SCOPE_STAGED';
        blockedSummary = `git commit for ${input.taskId} found out-of-scope source changes already staged; stage only task-allowed files or defer foreign staged bundles explicitly.`;
    }
    if (!blockedCode && input.apply && stageCandidates.length > 0) {
        runGitCommand(input.cwd, ['add', '--', ...stageCandidates], ['ignore', 'pipe', 'pipe']);
        stagedFiles = readStagedFiles(input.cwd);
    }
    if (!blockedCode && unexpectedStagedTasks.length > 0) {
        governanceBundleWarnings.push(`Foreign staged tasks remain in the index: ${unexpectedStagedTasks.map((entry) => entry.taskId).join(', ')}`);
    }
    return {
        schemaId: 'atm.taskScopedCommitBundle.v1',
        taskId: input.taskId,
        ok: blockedCode === null,
        apply: input.apply,
        stageFiles: input.apply && input.autoStage ? stageCandidates : inScopeUnstagedDirty,
        skippedExternalDirtyFiles: uniqueSorted(skippedExternalDirtyFiles),
        unexpectedStagedTasks,
        outOfScopeStagedFiles: uniqueSorted([...outOfScopeStagedFiles, ...outOfScopeStagedDeletions]),
        governanceBundleWarnings,
        blockedCode,
        blockedSummary,
        gitExecutable,
        copyableCommitCommand,
        deferredForeignStagedSnapshot
    };
}
function inspectTaskScopedStagedGovernanceBundle(cwd, taskId, taskDocument) {
    const stagedFiles = readStagedFiles(cwd);
    const claim = parseTaskClaim(taskDocument.claim);
    const warnings = [];
    const mismatchedTaskIds = [];
    if (claim?.state === 'active') {
        for (const filePath of stagedFiles) {
            if (!isAllowedGovernanceArtifactPath(filePath, taskId))
                continue;
            const stagedTaskId = extractGovernanceTaskIdFromPath(filePath);
            if (stagedTaskId && stagedTaskId !== taskId.toUpperCase()) {
                mismatchedTaskIds.push(filePath);
            }
            const json = readStagedJsonFile(cwd, filePath);
            if (json && typeof json.taskId === 'string' && json.taskId !== taskId) {
                mismatchedTaskIds.push(filePath);
            }
            if (json && typeof json.workItemId === 'string' && json.workItemId !== taskId) {
                mismatchedTaskIds.push(filePath);
            }
        }
        const declaredScope = resolveTaskDeclaredScope(cwd, taskId, taskDocument);
        const outOfScopeStaged = stagedFiles.filter((filePath) => !isFileAllowedInTaskBundle(filePath, taskId, declaredScope));
        if (outOfScopeStaged.length > 0) {
            warnings.push(`Pre-commit warning: staged files outside allowedFiles for ${taskId}: ${outOfScopeStaged.join(', ')}`);
            return {
                ok: false,
                code: 'ATM_GIT_COMMIT_GOVERNANCE_BUNDLE_TASK_MISMATCH',
                summary: `git commit for ${taskId} found staged files outside the active claim allowedFiles or with mismatched governance task ids.`,
                warnings,
                details: {
                    outOfScopeStagedFiles: uniqueSorted(outOfScopeStaged),
                    mismatchedTaskIds: uniqueSorted(mismatchedTaskIds)
                }
            };
        }
        if (mismatchedTaskIds.length > 0) {
            return {
                ok: false,
                code: 'ATM_GIT_COMMIT_GOVERNANCE_BUNDLE_TASK_MISMATCH',
                summary: `git commit for ${taskId} found staged governance artifacts whose task ids do not match the active claim.`,
                warnings,
                details: {
                    mismatchedTaskIds: uniqueSorted(mismatchedTaskIds)
                }
            };
        }
    }
    return {
        ok: true,
        code: 'ATM_GIT_COMMIT_GOVERNANCE_BUNDLE_OK',
        summary: `Staged governance bundle for ${taskId} passed task-id consistency checks.`,
        warnings,
        details: {}
    };
}
function inspectTaskScopedUnstagedCommit(cwd, taskId, taskDocument) {
    const stagedFiles = readStagedFiles(cwd);
    const declaredScope = resolveTaskDeclaredScope(cwd, taskId, taskDocument);
    const dirtyFiles = listTaskScopedWorktreeDirtyFiles(cwd);
    if (dirtyFiles.length === 0 && stagedFiles.length === 0) {
        return null;
    }
    const deliverableDirtyFiles = dirtyFiles.filter((filePath) => declaredScope.some((scope) => pathMatchesTaskScope(filePath, scope)));
    const skippedExternalDirtyFiles = dirtyFiles.filter((filePath) => !declaredScope.some((scope) => pathMatchesTaskScope(filePath, scope))
        && !isIgnorableCommitStagingSideEffect(filePath, taskId));
    const outOfScopeStagedFiles = stagedFiles.filter((filePath) => !isFileAllowedInTaskBundle(filePath, taskId, declaredScope));
    const unstagedInScopeDirty = deliverableDirtyFiles.filter((filePath) => !stagedFiles.includes(filePath));
    if (outOfScopeStagedFiles.length > 0 && (unstagedInScopeDirty.length > 0 || stagedFiles.some((file) => isFileAllowedInTaskBundle(file, taskId, declaredScope)))) {
        return {
            kind: 'mixed-scope',
            inScopeDirtyFiles: uniqueSorted(unstagedInScopeDirty.length > 0 ? unstagedInScopeDirty : deliverableDirtyFiles),
            outOfScopeStagedFiles: uniqueSorted(outOfScopeStagedFiles)
        };
    }
    if (stagedFiles.length > 0) {
        return null;
    }
    if (deliverableDirtyFiles.length === 0) {
        return null;
    }
    return {
        kind: 'staging-required',
        inScopeDirtyFiles: uniqueSorted(deliverableDirtyFiles),
        skippedExternalDirtyFiles: uniqueSorted(skippedExternalDirtyFiles),
        requiredCommand: buildTaskScopedStagingRequiredCommand(cwd, deliverableDirtyFiles)
    };
}
function isIgnorableCommitStagingSideEffect(filePath, taskId) {
    const normalized = normalizeRelativePath(filePath).toLowerCase();
    const normalizedTaskId = taskId.toLowerCase();
    if (normalized.startsWith('.atm/runtime/')) {
        return true;
    }
    if (normalized === `.atm/history/tasks/${normalizedTaskId}.json`) {
        return true;
    }
    if (normalized.startsWith(`.atm/history/task-events/${normalizedTaskId}/`)) {
        return true;
    }
    return false;
}
function resolveTaskDeclaredScope(cwd, taskId, taskDocument) {
    const taskDirectionLock = taskDocument.taskDirectionLock && typeof taskDocument.taskDirectionLock === 'object' && !Array.isArray(taskDocument.taskDirectionLock)
        ? taskDocument.taskDirectionLock
        : {};
    const claim = taskDocument.claim && typeof taskDocument.claim === 'object' && !Array.isArray(taskDocument.claim)
        ? taskDocument.claim
        : {};
    const lockAllowedFiles = getCanonicalAllowedFilesForTask(cwd, taskId) ?? [];
    return sanitizeTaskDirectionAllowedFiles(uniqueSorted([
        ...lockAllowedFiles,
        ...extractStringList(taskDirectionLock.allowedFiles),
        ...extractStringList(claim.files),
        ...extractStringList(taskDocument.targetAllowedFiles),
        ...extractTaskDeclaredFiles(taskDocument)
    ]));
}
function listTaskScopedWorktreeDirtyFiles(cwd) {
    const files = new Set();
    for (const filePath of readGitNameOnly(cwd, ['diff', '--name-only'])) {
        files.add(filePath);
    }
    for (const filePath of readGitNameOnly(cwd, ['ls-files', '-o', '--exclude-standard'])) {
        files.add(filePath);
    }
    return uniqueSorted([...files]);
}
function buildTaskScopedStagingRequiredCommand(cwd, files) {
    const normalizedFiles = uniqueSorted(files.map(normalizeRelativePath).filter(Boolean));
    const cwdFlag = path.resolve(cwd) === path.resolve(process.cwd())
        ? ''
        : ` -C ${quoteCliValue(cwd)}`;
    return `${quoteCliValue(resolveGitExecutable())}${cwdFlag} add -- ${normalizedFiles.map(quoteCliValue).join(' ')}`;
}
function pathMatchesTaskScope(filePath, scope) {
    const file = normalizeRelativePath(filePath).toLowerCase();
    const candidate = normalizeRelativePath(scope).toLowerCase();
    if (!candidate)
        return false;
    if (candidate.includes('*')) {
        const escaped = candidate
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '__ATM_DOUBLE_STAR__')
            .replace(/\*/g, '[^/]*')
            .replace(/__ATM_DOUBLE_STAR__/g, '.*');
        return new RegExp(`^${escaped}$`).test(file);
    }
    if (file === candidate)
        return true;
    if (candidate.endsWith('/'))
        return file.startsWith(candidate);
    return file.startsWith(`${candidate}/`);
}
function readGitNameOnly(cwd, args) {
    try {
        return runGitCommand(cwd, args)
            .split(/\r?\n/).map(normalizeRelativePath).filter(Boolean);
    }
    catch {
        return [];
    }
}
function extractStringList(value) {
    return Array.isArray(value)
        ? value.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean)
        : [];
}
function uniqueSorted(values) {
    return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
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
function normalizeRelativePath(value) {
    return value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}
function readGitConfig(cwd, key) {
    try {
        const value = execFileSync('git', ['config', '--local', '--get', key], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        return value || null;
    }
    catch {
        return null;
    }
}
function writeGitConfig(cwd, key, value) {
    execFileSync('git', ['config', '--local', key, value], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
}
function readHeadCommitMessage(cwd) {
    try {
        return execFileSync('git', ['log', '-1', '--pretty=%B'], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
    }
    catch {
        return null;
    }
}
function readHeadCommitSha(cwd) {
    try {
        const value = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        return value || null;
    }
    catch {
        return null;
    }
}
function parseTrailers(commitMessage) {
    if (!commitMessage) {
        return {};
    }
    const trailers = new Map();
    for (const line of commitMessage.split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z0-9-]+):\s*(.+)$/);
        if (!match)
            continue;
        const key = match[1];
        const value = match[2].trim();
        if (!trailers.has(key)) {
            trailers.set(key, []);
        }
        trailers.get(key)?.push(value);
    }
    return Object.fromEntries(Array.from(trailers.entries()));
}
function requireTrailerValue(trailers, key, expectedValue, violations, code) {
    const values = trailers[key] ?? [];
    if (!values.includes(expectedValue)) {
        violations.push({
            code,
            detail: `Latest commit is missing trailer ${key}: ${expectedValue}.`
        });
    }
}
function requireValue(argv, index, flag) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `git requires a value for ${flag}`, { exitCode: 2 });
    }
    return value;
}
