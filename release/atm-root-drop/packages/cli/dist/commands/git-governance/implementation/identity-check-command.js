import { reconcileResolvedCrossTaskMutationIncident } from './git-head-evidence-transaction.js';
import { existsSync, readFileSync, } from "node:fs";
import path from "node:path";
import { actorIdEnvVar, findActorByResolvedId, readRuntimeIdentityDefault, readRuntimeIdentityForActor, resolveActorId, writeRuntimeIdentityForActor, } from "../../actor-registry.js";
import { resolveActorWorkSession } from "../../actor-session.js";
import { detectCrossTaskMutation, recordIncidentFlag, } from "../../../_vendor/core/dist/broker/cross-task-mutation-guard.js";
import { CliError, makeResult, message, quoteCliValue, relativePathFrom, } from "../../shared.js";
import { inspectCurrentBranchCommitQueueStatus } from './branch-commit-window.js';
import { laneSessionIdFromRecord } from './command-router.js';
import { inspectCloseCommitWindowStagedArtifacts } from './git-index-transaction.js';
import { inspectStdinPathspecGitAddProcesses, readGitCommitAttemptStatus } from './git-process-port.js';
import { readGitConfig, writeGitConfig } from './git-config-port.js';
import { readHeadCommitMessage } from './push-command.js';
import { inspectHistoricalLedgerRestoreStagedArtifacts, inspectMirrorSyncOnlyStagedArtifacts } from './record-bundle-inspection.js';
export function resolveActorGitIdentityForCommit(cwd, actorId) {
    const resolvedActor = resolveActorId(actorId, cwd);
    const actorRecord = resolvedActor
        ? findActorByResolvedId(cwd, resolvedActor)
        : null;
    return resolveGitIdentityProfile(cwd, actorId, actorRecord);
}
export function evaluateGitGovernanceCheck(input) {
    const cwd = path.resolve(input.cwd);
    const resolvedActor = resolveActorId(input.actorInput ?? undefined, cwd);
    if (!resolvedActor) {
        throw new CliError("ATM_ACTOR_ID_MISSING", `git check requires --actor or ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
    }
    requireExplicitGitActor(resolvedActor, "git check");
    const actorId = resolvedActor.actorId;
    const actorRecord = findActorByResolvedId(cwd, resolvedActor);
    const profile = resolveGitIdentityProfile(cwd, actorId, actorRecord);
    const gitName = readGitConfig(cwd, "user.name");
    const gitEmail = readGitConfig(cwd, "user.email");
    const taskDocument = input.taskId
        ? readTaskDocument(cwd, input.taskId)
        : null;
    const claim = taskDocument ? parseTaskClaim(taskDocument.claim) : null;
    const stagedMirrorSync = input.taskId
        ? inspectMirrorSyncOnlyStagedArtifacts(cwd, input.taskId)
        : null;
    const stagedHistoricalRestore = input.taskId
        ? inspectHistoricalLedgerRestoreStagedArtifacts(cwd, input.taskId)
        : null;
    const stagedCloseCommitWindow = input.taskId
        ? inspectCloseCommitWindowStagedArtifacts(cwd, input.taskId)
        : null;
    const bypassesActiveSession = stagedMirrorSync?.ok ||
        stagedHistoricalRestore?.ok ||
        stagedCloseCommitWindow?.ok;
    const claimForTrailers = bypassesActiveSession ? null : claim;
    const session = resolveGitGovernanceSession(cwd, {
        sessionId: input.sessionId ?? null,
        actorId,
        taskId: input.taskId,
        claimLeaseId: claimForTrailers?.leaseId ?? null,
        allowImplicitSession: Boolean(input.taskId && !bypassesActiveSession),
    });
    const trailers = parseTrailers(readHeadCommitMessage(cwd));
    const violations = [];
    const crossTaskBlock = detectCrossTaskMutation(cwd, input.taskId, "git check");
    if (crossTaskBlock) {
        recordIncidentFlag(cwd, crossTaskBlock);
        violations.push({
            code: "cross-task-mutation-incident",
            detail: `Cross-task mutation incident detected: files owned by active task ${crossTaskBlock.conflictTaskId} are mutated. File(s): ${crossTaskBlock.conflictFiles.join(", ")}. Recovery: ${crossTaskBlock.recoveryLane}`,
        });
    }
    else {
        reconcileResolvedCrossTaskMutationIncident(cwd, input.taskId);
    }
    if (!profile.gitName || !profile.gitEmail) {
        violations.push({
            code: "git-identity-profile-missing",
            detail: `Actor ${actorId} has no resolved git identity profile in actor registry or .atm/runtime/identity/default.json.`,
        });
    }
    if (profile.gitName && gitName !== profile.gitName) {
        violations.push({
            code: "git-name-mismatch",
            detail: `git user.name is ${gitName ?? "unset"}, expected ${profile.gitName}.`,
        });
    }
    if (profile.gitEmail && gitEmail !== profile.gitEmail) {
        violations.push({
            code: "git-email-mismatch",
            detail: `git user.email is ${gitEmail ?? "unset"}, expected ${profile.gitEmail}.`,
        });
    }
    if (!stagedHistoricalRestore?.ok &&
        taskDocument &&
        taskDocument.owner &&
        String(taskDocument.owner) !== actorId) {
        violations.push({
            code: "task-owner-mismatch",
            detail: `Task owner is ${String(taskDocument.owner)}, not ${actorId}.`,
        });
    }
    if (!stagedHistoricalRestore?.ok &&
        claim &&
        claim.state === "active" &&
        claim.actorId !== actorId) {
        violations.push({
            code: "claim-owner-mismatch",
            detail: `Task claim owner is ${claim.actorId}, not ${actorId}.`,
        });
    }
    if (session && session.actorId !== actorId) {
        violations.push({
            code: "session-actor-mismatch",
            detail: `Active session ${session.sessionId} belongs to ${session.actorId}, not ${actorId}.`,
        });
    }
    if (session && input.taskId && session.taskId !== input.taskId) {
        violations.push({
            code: "session-task-mismatch",
            detail: `Active session ${session.sessionId} is for ${session.taskId}, not ${input.taskId}.`,
        });
    }
    if (session &&
        claim?.leaseId &&
        session.claimLeaseId &&
        session.claimLeaseId !== claim.leaseId) {
        violations.push({
            code: "session-claim-mismatch",
            detail: `Active session ${session.sessionId} is bound to claim ${session.claimLeaseId}, not ${claim.leaseId}.`,
        });
    }
    if (input.requireTrailers) {
        requireTrailerValue(trailers, "ATM-Actor", actorId, violations, "trailer-actor-missing");
        if (input.taskId) {
            requireTrailerValue(trailers, "ATM-Task", input.taskId, violations, "trailer-task-missing");
        }
        if (claimForTrailers?.leaseId) {
            requireTrailerValue(trailers, "ATM-Claim", claimForTrailers.leaseId, violations, "trailer-claim-missing");
        }
        if (session?.sessionId) {
            requireTrailerValue(trailers, "ATM-Session", session.sessionId, violations, "trailer-session-missing");
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
        violations,
    };
}
export function runGitPrepare(options) {
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError("ATM_ACTOR_ID_MISSING", `git prepare requires --actor or ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
    }
    requireExplicitGitActor(resolvedActor, "git prepare");
    const actorId = resolvedActor.actorId;
    const actorRecord = findActorByResolvedId(options.cwd, resolvedActor);
    const profile = resolveGitIdentityProfile(options.cwd, actorId, actorRecord, {
        explicitGitName: options.gitName,
        explicitGitEmail: options.gitEmail,
    });
    const nextName = profile.gitName;
    const nextEmail = profile.gitEmail;
    if (!nextName || !nextEmail) {
        throw new CliError("ATM_GIT_PREPARE_IDENTITY_MISSING", "git prepare requires git name/email from actor registry, repo default identity, or explicit --name/--email.", { exitCode: 2, details: { actorId } });
    }
    writeGitConfig(options.cwd, "user.name", nextName);
    writeGitConfig(options.cwd, "user.email", nextEmail);
    if (readGitConfig(options.cwd, "user.name") !== nextName || readGitConfig(options.cwd, "user.email") !== nextEmail) {
        throw new CliError("ATM_GIT_PREPARE_IDENTITY_WRITE_FAILED", "git prepare could not verify the local Git identity after writing it.", { exitCode: 1, details: { actorId, gitName: nextName, gitEmail: nextEmail } });
    }
    const identityPath = options.gitName !== null && options.gitEmail !== null
        ? writePreparedRuntimeIdentity(options.cwd, actorId, nextName, nextEmail, actorRecord)
        : null;
    const taskDocument = options.taskId
        ? readTaskDocument(options.cwd, options.taskId)
        : null;
    const claim = taskDocument ? parseTaskClaim(taskDocument.claim) : null;
    const session = resolveGitGovernanceSession(options.cwd, {
        sessionId: options.sessionId ?? null,
        actorId,
        taskId: options.taskId,
        claimLeaseId: claim?.leaseId ?? null,
        allowImplicitSession: Boolean(options.taskId),
    });
    const trailerHints = [
        `ATM-Actor: ${actorId}`,
        ...(options.taskId ? [`ATM-Task: ${options.taskId}`] : []),
        ...(claim?.leaseId ? [`ATM-Claim: ${claim.leaseId}`] : []),
        ...(session?.sessionId ? [`ATM-Session: ${session.sessionId}`] : []),
        ...(options.taskId
            ? [`ATM-Evidence: .atm/history/evidence/${options.taskId}.json`]
            : []),
    ];
    return makeResult({
        ok: true,
        command: "git",
        cwd: options.cwd,
        messages: [
            message("info", "ATM_GIT_PREPARED", "Actor git identity has been prepared for the resolved actor.", {
                actorId,
                gitName: nextName,
                gitEmail: nextEmail,
                runtimeIdentityPath: identityPath,
            }),
        ],
        evidence: {
            action: "prepare",
            actorId,
            identityPath,
            sessionId: session?.sessionId ?? null,
            git: { name: nextName, email: nextEmail },
            trailerHints,
        },
    });
}
export function runGitCommitStatus(options) {
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError("ATM_ACTOR_ID_MISSING", "git commit-status requires --actor or ATM_ACTOR_ID.", { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    const status = readGitCommitAttemptStatus(options.cwd, actorId, options.taskId);
    const branchQueueStatus = inspectCurrentBranchCommitQueueStatus(options.cwd);
    const stdinPathspecGitAddProcesses = inspectStdinPathspecGitAddProcesses();
    const label = `${actorId}${options.taskId ? ` / ${options.taskId}` : ""}`;
    return makeResult({
        ok: true,
        command: "git",
        cwd: options.cwd,
        messages: [
            status
                ? message("info", "ATM_GIT_COMMIT_STATUS_FOUND", `Last known governed commit attempt for ${label} is ${status.status} (phase: ${status.phase}).`, { status })
                : message("info", "ATM_GIT_COMMIT_STATUS_NOT_FOUND", `No recorded governed commit attempt for ${label}.`, {}),
            branchQueueStatus.status === "free"
                ? message("info", "ATM_GIT_COMMIT_BRANCH_QUEUE_FREE", "No active branch commit queue lock is present.", { branchQueueStatus })
                : message(branchQueueStatus.status === "busy" ? "warning" : "warning", branchQueueStatus.status === "busy"
                    ? "ATM_GIT_COMMIT_BRANCH_QUEUE_ACTIVE"
                    : "ATM_GIT_COMMIT_BRANCH_QUEUE_STALE_OR_DEAD", branchQueueStatus.recommendedAction, { branchQueueStatus }),
            stdinPathspecGitAddProcesses.length === 0
                ? message("info", "ATM_GIT_COMMIT_STDIN_PATHSPEC_ADD_CLEAR", "No active git add stdin pathspec helper was detected.", {})
                : message("warning", "ATM_GIT_COMMIT_STDIN_PATHSPEC_ADD_ACTIVE", "An active git add --pathspec-from-file=- helper was detected; this can make a commit appear stuck while the helper waits for stdin.", {
                    processes: stdinPathspecGitAddProcesses,
                    recovery: "Terminate only the listed stuck helper after confirming it is not an intentional staging operation, then stage files explicitly with git add -- <paths>.",
                }),
        ],
        evidence: {
            action: "commit-status",
            actorId,
            taskId: options.taskId,
            commitAttemptStatus: status,
            branchCommitQueueStatus: branchQueueStatus,
            stdinPathspecGitAddProcesses,
        },
    });
}
export function requireExplicitGitActor(resolvedActor, action) {
    if (resolvedActor.source !== "repo-default")
        return;
    const editorHint = process.env.ATM_EDITOR_ID?.trim() ||
        (process.env.CODEX_HOME?.trim() ? "codex" : null) ||
        "<editor-id>";
    throw new CliError("ATM_ACTOR_ID_EXPLICIT_REQUIRED", `${action} requires an explicit actor. Repo default identity is advisory only and must not be reused across editors or agents.`, {
        exitCode: 2,
        details: {
            resolvedActorId: resolvedActor.actorId,
            resolvedFrom: resolvedActor.source,
            currentEditorHint: editorHint,
            clearStaleDefaultCommand: "node atm.mjs identity clear --json",
            requiredCommand: `node atm.mjs identity clear --json && node atm.mjs identity set --actor <actor-id> --editor ${quoteCliValue(editorHint)} --git-name "<git user.name>" --git-email "<git user.email>" --json`,
            usage: `node atm.mjs ${action} --actor <actor-id> ...`,
        },
    });
}
export function resolveGitIdentityProfile(cwd, actorId, actorRecord, overrides = {}) {
    const explicitGitName = overrides?.explicitGitName?.trim() || null;
    const explicitGitEmail = overrides?.explicitGitEmail?.trim() || null;
    if (explicitGitName || explicitGitEmail) {
        return { gitName: explicitGitName, gitEmail: explicitGitEmail };
    }
    const envGitName = process.env.ATM_GIT_NAME?.trim() || null;
    const envGitEmail = process.env.ATM_GIT_EMAIL?.trim() || null;
    if (envGitName || envGitEmail) {
        return { gitName: envGitName, gitEmail: envGitEmail };
    }
    const actorIdentity = readRuntimeIdentityForActor(cwd, actorId);
    if (actorIdentity?.gitName || actorIdentity?.gitEmail) {
        return {
            gitName: actorIdentity.gitName ?? null,
            gitEmail: actorIdentity.gitEmail ?? null,
        };
    }
    if (actorRecord?.gitName || actorRecord?.gitEmail) {
        return {
            gitName: actorRecord.gitName ?? null,
            gitEmail: actorRecord.gitEmail ?? null,
        };
    }
    const defaultIdentity = readRuntimeIdentityDefault(cwd);
    if (defaultIdentity &&
        defaultIdentity.actorId === actorId &&
        (defaultIdentity.gitName || defaultIdentity.gitEmail)) {
        return {
            gitName: defaultIdentity.gitName ?? null,
            gitEmail: defaultIdentity.gitEmail ?? null,
        };
    }
    return { gitName: null, gitEmail: null };
}
export function writePreparedRuntimeIdentity(cwd, actorId, gitName, gitEmail, actorRecord) {
    const defaultIdentity = readRuntimeIdentityDefault(cwd);
    const existing = readRuntimeIdentityForActor(cwd, actorId) ??
        (defaultIdentity?.actorId === actorId ? defaultIdentity : null);
    return writeRuntimeIdentityForActor(cwd, actorId, {
        schemaId: "atm.identityDefault.v1",
        specVersion: "0.1.0",
        actorId,
        gitName,
        gitEmail,
        editor: existing?.editor ?? actorRecord?.editor ?? null,
        provider: existing?.provider ?? actorRecord?.provider ?? null,
        activeSessionId: existing?.activeSessionId ?? null,
        updatedAt: new Date().toISOString(),
    });
}
export function buildIdentitySetRequiredCommand(cwd, actorId) {
    return `node atm.mjs identity set --actor ${quoteCliValue(actorId)} --git-name "<git user.name>" --git-email "<git user.email>" --json`;
}
export function readTaskDocument(cwd, taskId) {
    const taskPath = path.join(cwd, ".atm", "history", "tasks", `${taskId}.json`);
    if (!existsSync(taskPath)) {
        throw new CliError("ATM_TASK_NOT_FOUND", `Task file not found for ${taskId}.`, {
            exitCode: 2,
            details: { taskId, taskPath: relativePathFrom(cwd, taskPath) },
        });
    }
    return JSON.parse(readFileSync(taskPath, "utf8"));
}
export function parseTaskClaim(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const candidate = value;
    const actorId = typeof candidate.actorId === "string" ? candidate.actorId.trim() : "";
    const leaseId = typeof candidate.leaseId === "string" ? candidate.leaseId.trim() : "";
    const stateRaw = typeof candidate.state === "string" ? candidate.state.trim() : "active";
    const state = stateRaw === "released" ||
        stateRaw === "handoff" ||
        stateRaw === "taken_over"
        ? stateRaw
        : "active";
    if (!actorId || !leaseId) {
        return null;
    }
    const laneSession = laneSessionIdFromRecord(candidate.laneSession)
        ? { laneSessionId: laneSessionIdFromRecord(candidate.laneSession) }
        : null;
    return { actorId, leaseId, state, ...(laneSession ? { laneSession } : {}) };
}
export function resolveGitGovernanceSession(cwd, input) {
    if (!input.sessionId && !input.allowImplicitSession) {
        return null;
    }
    return resolveActorWorkSession(cwd, {
        sessionId: input.sessionId,
        actorId: input.actorId,
        taskId: input.taskId,
        claimLeaseId: input.claimLeaseId,
        includeNonActive: true,
    });
}
export { readGitConfig, writeGitConfig } from './git-config-port.js';
export function parseTrailers(commitMessage) {
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
export function requireTrailerValue(trailers, key, expectedValue, violations, code) {
    const values = trailers[key] ?? [];
    if (!values.includes(expectedValue)) {
        violations.push({
            code,
            detail: `Latest commit is missing trailer ${key}: ${expectedValue}.`,
        });
    }
}
