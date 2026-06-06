import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { actorIdEnvVar, findActorByResolvedId, readRuntimeIdentityDefault, resolveActorId, writeRuntimeIdentityDefault } from './actor-registry.js';
import { resolveActorWorkSession } from './actor-session.js';
import { CliError, makeResult, message, quoteCliValue, relativePathFrom } from './shared.js';
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
    const bypassesActiveSession = stagedMirrorSync?.ok || stagedHistoricalRestore?.ok;
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
    const bypassesActiveSession = stagedMirrorSync?.ok || stagedHistoricalRestore?.ok;
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
    try {
        execFileSync('git', args, {
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
        const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr ?? '') : '';
        const stdout = error instanceof Error && 'stdout' in error ? String(error.stdout ?? '') : '';
        throw new CliError('ATM_GIT_COMMIT_FAILED', 'ATM git commit wrapper failed.', {
            exitCode: 1,
            details: {
                actorId,
                taskId: options.taskId,
                sessionId: session?.sessionId ?? null,
                stdout,
                stderr
            }
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
            git: profile
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
        checkTrailers: true
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
        if (arg === '--no-trailers') {
            options.checkTrailers = false;
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
        return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMRT'], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).split(/\r?\n/).map(normalizeRelativePath).filter(Boolean).sort((left, right) => left.localeCompare(right));
    }
    catch {
        return [];
    }
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
