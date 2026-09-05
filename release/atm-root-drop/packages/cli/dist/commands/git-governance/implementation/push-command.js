import { createSanitizedGitEnv, resolveGitExecutable, runGitCommandWithTimeout, } from './git-process-port.js';
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, } from "node:fs";
import path from "node:path";
import { actorIdEnvVar, } from "../../actor-registry.js";
import { evaluateGitAdmission } from "../../../_vendor/core/dist/git/admission.js";
import { buildGitBoundaryEvidenceEnvelope } from "../../../_vendor/core/dist/evidence/index.js";
import { CliError, makeResult, message, quoteCliValue, } from "../../shared.js";
import { buildPostPushRecoveryRecommendation, classifyPostPushRecoveryKind, } from './push-recovery.js';
export function gitPushAttemptStatusRelativePath(actorId, branch, remote) {
    const safeActor = actorId.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const safeTarget = `${remote}__${branch}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
    return `.atm/runtime/git-push-attempts/${safeActor}__${safeTarget}.json`;
}
export function writeGitPushAttemptStatus(cwd, statusRelativePath, status) {
    try {
        const absolutePath = path.join(cwd, statusRelativePath);
        mkdirSync(path.dirname(absolutePath), { recursive: true });
        writeFileSync(absolutePath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
    }
    catch { }
}
export function runGitPush(options) {
    if (!options.actorId?.trim()) {
        throw new CliError("ATM_ACTOR_ID_MISSING", `git push requires --actor or ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
    }
    const branch = options.branch?.trim() || resolveCurrentBranchName(options.cwd);
    const remote = options.remote?.trim() || "origin";
    const statusPath = gitPushAttemptStatusRelativePath(options.actorId, branch, remote);
    const startedAt = new Date().toISOString();
    const headShaBeforePush = readHeadCommitSha(options.cwd);
    writeGitPushAttemptStatus(options.cwd, statusPath, {
        schemaId: "atm.gitPushAttemptStatus.v1",
        actorId: options.actorId,
        taskId: options.taskId,
        branch,
        remote,
        status: "in-progress",
        phase: "admission",
        dryRun: options.dryRun,
        startedAt,
        updatedAt: startedAt,
        headShaBeforePush,
        requiredCommand: `node atm.mjs git push --actor ${quoteCliValue(options.actorId)} --branch ${quoteCliValue(branch)} --remote ${quoteCliValue(remote)} --json`,
    });
    const admission = evaluateGitAdmission({
        cwd: options.cwd,
        actorId: options.actorId,
        taskId: options.taskId,
        branch,
        remote,
        fetch: !options.noFetch,
        gitExecutable: resolveGitExecutable(),
    });
    const admissionOk = admission.outcome === "allow" || admission.outcome === "no-op";
    const gitBoundaryEvidence = buildGitBoundaryEvidenceEnvelope({
        actorId: options.actorId,
        taskId: options.taskId,
        result: admission,
    });
    if (!admissionOk) {
        const updatedAt = new Date().toISOString();
        writeGitPushAttemptStatus(options.cwd, statusPath, {
            schemaId: "atm.gitPushAttemptStatus.v1",
            actorId: options.actorId,
            taskId: options.taskId,
            branch,
            remote,
            status: "blocked",
            phase: "admission",
            dryRun: options.dryRun,
            startedAt,
            updatedAt,
            headShaBeforePush,
            headShaAfterAttempt: readHeadCommitSha(options.cwd),
            admissionOutcome: admission.outcome,
            conflictingFiles: admission.conflictingFiles,
            retryCommand: `node atm.mjs git push --actor ${quoteCliValue(options.actorId)} --branch ${quoteCliValue(branch)} --remote ${quoteCliValue(remote)} --json`,
            recoveryCommand: `node atm.mjs git recover-push-fail --actor ${quoteCliValue(options.actorId)} --branch ${quoteCliValue(branch)} --remote ${quoteCliValue(remote)} --json`,
        });
        return makeResult({
            ok: false,
            command: "git",
            cwd: options.cwd,
            messages: [
                message("error", `ATM_GIT_PUSH_ADMISSION_${admission.outcome.toUpperCase().replace(/-/g, "_")}`, `ATM git push blocked before host git push: admission outcome '${admission.outcome}'.`, {
                    branch,
                    remote,
                    outcome: admission.outcome,
                    conflictingFiles: admission.conflictingFiles,
                    recommendedNextStep: admission.recommendedNextStep,
                }),
            ],
            evidence: {
                action: "push",
                dryRun: options.dryRun,
                actorId: options.actorId,
                taskId: options.taskId,
                branch,
                remote,
                statusPath,
                admission,
                gitBoundaryEvidence,
                hostPush: null,
                recommendedNextStep: admission.recommendedNextStep,
            },
        });
    }
    if (options.dryRun || admission.outcome === "no-op") {
        const updatedAt = new Date().toISOString();
        const status = options.dryRun ? "dry-run" : "no-op";
        writeGitPushAttemptStatus(options.cwd, statusPath, {
            schemaId: "atm.gitPushAttemptStatus.v1",
            actorId: options.actorId,
            taskId: options.taskId,
            branch,
            remote,
            status,
            phase: "complete",
            dryRun: options.dryRun,
            startedAt,
            updatedAt,
            headShaBeforePush,
            headShaAfterAttempt: readHeadCommitSha(options.cwd),
            admissionOutcome: admission.outcome,
        });
        return makeResult({
            ok: true,
            command: "git",
            cwd: options.cwd,
            messages: [
                message("info", options.dryRun ? "ATM_GIT_PUSH_DRY_RUN_ALLOW" : "ATM_GIT_PUSH_NO_OP", options.dryRun
                    ? "ATM git push dry-run passed admission; no host git push was executed."
                    : "ATM git push found no local commits to publish; no host git push was needed.", { branch, remote, outcome: admission.outcome }),
            ],
            evidence: {
                action: "push",
                dryRun: options.dryRun,
                actorId: options.actorId,
                taskId: options.taskId,
                branch,
                remote,
                statusPath,
                admission,
                gitBoundaryEvidence,
                hostPush: null,
            },
        });
    }
    try {
        const stdout = runGitCommandWithTimeout(options.cwd, ["push", remote, `HEAD:${branch}`], null, ["ignore", "pipe", "pipe"]);
        const updatedAt = new Date().toISOString();
        const remoteShaAfterPush = readRevisionIfExists(options.cwd, `${remote}/${branch}`);
        writeGitPushAttemptStatus(options.cwd, statusPath, {
            schemaId: "atm.gitPushAttemptStatus.v1",
            actorId: options.actorId,
            taskId: options.taskId,
            branch,
            remote,
            status: "pushed",
            phase: "complete",
            dryRun: false,
            startedAt,
            updatedAt,
            headShaBeforePush,
            headShaAfterAttempt: readHeadCommitSha(options.cwd),
            admissionOutcome: admission.outcome,
            remoteShaAfterPush,
        });
        return makeResult({
            ok: true,
            command: "git",
            cwd: options.cwd,
            messages: [
                message("info", "ATM_GIT_PUSH_OK", "ATM git push completed after governed admission.", { branch, remote, headSha: headShaBeforePush, remoteShaAfterPush }),
            ],
            evidence: {
                action: "push",
                dryRun: false,
                actorId: options.actorId,
                taskId: options.taskId,
                branch,
                remote,
                statusPath,
                admission,
                gitBoundaryEvidence,
                hostPush: {
                    command: `git push ${remote} HEAD:${branch}`,
                    exitCode: 0,
                    stdout,
                },
            },
        });
    }
    catch (error) {
        const updatedAt = new Date().toISOString();
        const stderr = error && typeof error === "object" && "stderr" in error
            ? String(error.stderr ?? "")
            : String(error);
        writeGitPushAttemptStatus(options.cwd, statusPath, {
            schemaId: "atm.gitPushAttemptStatus.v1",
            actorId: options.actorId,
            taskId: options.taskId,
            branch,
            remote,
            status: "failed",
            phase: "host-push",
            dryRun: false,
            startedAt,
            updatedAt,
            headShaBeforePush,
            headShaAfterAttempt: readHeadCommitSha(options.cwd),
            admissionOutcome: admission.outcome,
            errorSummary: stderr.slice(0, 4000),
            recoveryCommand: `node atm.mjs git recover-push-fail --actor ${quoteCliValue(options.actorId)} --branch ${quoteCliValue(branch)} --remote ${quoteCliValue(remote)} --json`,
        });
        return makeResult({
            ok: false,
            command: "git",
            cwd: options.cwd,
            messages: [
                message("error", "ATM_GIT_PUSH_FAILED", "Host git push failed after governed admission; rerun recover-push-fail for refreshed guidance.", {
                    branch,
                    remote,
                    recoveryCommand: `node atm.mjs git recover-push-fail --actor ${quoteCliValue(options.actorId)} --branch ${quoteCliValue(branch)} --remote ${quoteCliValue(remote)} --json`,
                    stderr: stderr.slice(0, 4000),
                }),
            ],
            evidence: {
                action: "push",
                dryRun: false,
                actorId: options.actorId,
                taskId: options.taskId,
                branch,
                remote,
                statusPath,
                admission,
                gitBoundaryEvidence,
                hostPush: {
                    command: `git push ${remote} HEAD:${branch}`,
                    exitCode: 1,
                    stderr,
                },
                recoveryCommand: `node atm.mjs git recover-push-fail --actor ${quoteCliValue(options.actorId)} --branch ${quoteCliValue(branch)} --remote ${quoteCliValue(remote)} --json`,
            },
        });
    }
}
export function runGitPostPushFailRecovery(options) {
    if (!options.actorId?.trim()) {
        throw new CliError("ATM_ACTOR_ID_MISSING", `git recover-push-fail requires --actor or ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
    }
    const branch = options.branch?.trim() || resolveCurrentBranchName(options.cwd);
    const remote = options.remote?.trim() || "origin";
    const remoteRef = `${remote}/${branch}`;
    const localHeadBeforeFetch = readHeadCommitSha(options.cwd);
    const remoteHeadBeforeFetch = readRevisionIfExists(options.cwd, remoteRef);
    const localBehindRemoteBeforeFetch = isAncestorCommit(options.cwd, localHeadBeforeFetch, remoteHeadBeforeFetch);
    const localDivergedBeforeFetch = haveDiverged(options.cwd, localHeadBeforeFetch, remoteHeadBeforeFetch);
    const result = evaluateGitAdmission({
        cwd: options.cwd,
        actorId: options.actorId,
        taskId: options.taskId,
        branch,
        remote,
        fetch: true,
        gitExecutable: resolveGitExecutable(),
    });
    const remoteHeadAfterFetch = result.topology.remoteSha;
    const remoteChangedAfterFetch = Boolean(remoteHeadBeforeFetch &&
        remoteHeadAfterFetch &&
        remoteHeadBeforeFetch !== remoteHeadAfterFetch);
    const localBehindRemoteAfterFetch = isAncestorCommit(options.cwd, result.topology.headSha, result.topology.remoteSha);
    const localDivergedAfterFetch = haveDiverged(options.cwd, result.topology.headSha, result.topology.remoteSha);
    const likelyRemoteChanged = remoteChangedAfterFetch ||
        localBehindRemoteBeforeFetch ||
        localDivergedBeforeFetch;
    const likelyNonFastForward = localBehindRemoteAfterFetch || localDivergedAfterFetch;
    const recoveryRecommendation = buildPostPushRecoveryRecommendation({
        outcome: result.outcome,
        remoteChangedAfterFetch,
        likelyRemoteChanged,
        likelyNonFastForward,
        conflictingFiles: result.conflictingFiles,
        defaultRecommendation: result.recommendedNextStep,
    });
    const recoveryKind = classifyPostPushRecoveryKind({
        outcome: result.outcome,
        likelyNonFastForward,
        remoteChangedAfterFetch,
    });
    const gitBoundaryEvidence = buildGitBoundaryEvidenceEnvelope({
        actorId: options.actorId,
        taskId: options.taskId,
        result,
    });
    const evidence = {
        action: "recover-push-fail",
        outcome: result.outcome,
        topology: result.topology,
        brokerRegistryPath: path.relative(options.cwd, result.brokerRegistryPath) ||
            path.basename(result.brokerRegistryPath),
        conflictingFiles: result.conflictingFiles,
        recommendedNextStep: recoveryRecommendation,
        brokerDecision: result.brokerDecision,
        diagnostics: result.diagnostics,
        local: result.local,
        remote: result.remote,
        gitBoundaryEvidence,
        recovery: {
            mode: "post-push-fail",
            branch,
            remote,
            remoteRef,
            fetched: true,
            recoveryKind,
            localHeadBeforeFetch,
            remoteHeadBeforeFetch,
            remoteHeadAfterFetch,
            remoteChangedAfterFetch,
            likelyRemoteChanged,
            likelyNonFastForward,
            localBehindRemoteBeforeFetch,
            localBehindRemoteAfterFetch,
            localDivergedBeforeFetch,
            localDivergedAfterFetch,
        },
    };
    const ok = result.outcome === "allow" ||
        result.outcome === "no-op" ||
        result.outcome === "composer-routed";
    return makeResult({
        ok,
        command: "git",
        cwd: options.cwd,
        messages: [
            message(result.outcome === "block" || result.outcome === "internal-error"
                ? "error"
                : result.outcome === "composer-routed"
                    ? "warn"
                    : "info", `ATM_GIT_POST_PUSH_FAIL_${result.outcome.toUpperCase().replace(/-/g, "_")}`, `Post-push recovery outcome '${result.outcome}' after refreshing ${remoteRef}. ${recoveryRecommendation}`, {
                outcome: result.outcome,
                branch,
                remote,
                remoteRef,
                conflictingFiles: result.conflictingFiles,
                recommendedNextStep: recoveryRecommendation,
                recoveryKind,
                remoteChangedAfterFetch,
                likelyNonFastForward,
            }),
        ],
        evidence,
    });
}
export function readHeadCommitMessage(cwd) {
    try {
        return execFileSync("git", ["log", "-1", "--pretty=%B"], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            env: createSanitizedGitEnv(),
        });
    }
    catch {
        return null;
    }
}
export function readHeadBranchRef(cwd) {
    try {
        const value = execFileSync("git", ["symbolic-ref", "-q", "HEAD"], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            env: createSanitizedGitEnv(),
        }).trim();
        return value || null;
    }
    catch {
        return null;
    }
}
export function readHeadCommitSha(cwd) {
    try {
        const value = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            env: createSanitizedGitEnv(),
        }).trim();
        return value || null;
    }
    catch {
        return null;
    }
}
export function resolveCurrentBranchName(cwd) {
    try {
        const value = execFileSync("git", ["branch", "--show-current"], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            env: createSanitizedGitEnv(),
        }).trim();
        return value || "main";
    }
    catch {
        return "main";
    }
}
export function readRevisionIfExists(cwd, revision) {
    try {
        const value = execFileSync("git", ["rev-parse", "--verify", revision], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            env: createSanitizedGitEnv(),
        }).trim();
        return value || null;
    }
    catch {
        return null;
    }
}
export function isAncestorCommit(cwd, left, right) {
    if (!left || !right) {
        return false;
    }
    try {
        execFileSync("git", ["merge-base", "--is-ancestor", left, right], {
            cwd,
            stdio: "ignore",
            env: createSanitizedGitEnv(),
        });
        return true;
    }
    catch {
        return false;
    }
}
export function haveDiverged(cwd, left, right) {
    if (!left || !right || left === right) {
        return false;
    }
    return (!isAncestorCommit(cwd, left, right) && !isAncestorCommit(cwd, right, left));
}
export { buildPostPushRecoveryRecommendation, classifyPostPushRecoveryKind, isHeadRaceCommitFailure } from './push-recovery.js';
