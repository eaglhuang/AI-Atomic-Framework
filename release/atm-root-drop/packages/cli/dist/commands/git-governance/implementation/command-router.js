import { evaluateGitGovernanceCheck, runGitCommitStatus, runGitPrepare, } from './identity-check-command.js';
import { makeResult, message, } from "../../shared.js";
import { runGitAdmission } from './admission-command.js';
import { runGitCommit } from './commit-command.js';
import { parseGitOptions } from './git-command-options.js';
import { runGitLease } from './lease-command.js';
import { runGitPostPushFailRecovery, runGitPush } from './push-command.js';
import { runGitRecordCommit } from './record-commit-command.js';
export function normalizeCommitLaneSessionId(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
export function laneSessionIdFromRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const record = value;
    return normalizeCommitLaneSessionId(record.laneSessionId);
}
export function resolveCommitLaneSessionId(input = {}) {
    const env = input.env ?? process.env;
    const envRecord = env && typeof env === "object" ? env : {};
    return (normalizeCommitLaneSessionId(envRecord.ATM_COMMIT_LANE_SESSION_ID) ??
        normalizeCommitLaneSessionId(envRecord.ATM_LANE_SESSION_ID) ??
        laneSessionIdFromRecord(input.claim?.laneSession) ??
        laneSessionIdFromRecord(input.laneSession) ??
        normalizeCommitLaneSessionId(input.session?.guidanceSessionId) ??
        null);
}
export async function runAtmGit(argv) {
    const options = parseGitOptions(argv);
    if (options.action === "prepare") {
        return runGitPrepare(options);
    }
    if (options.action === "admit") {
        return runGitAdmission(options);
    }
    if (options.action === "push") {
        return runGitPush(options);
    }
    if (options.action === "recover-push-fail") {
        return runGitPostPushFailRecovery(options);
    }
    if (options.action === "lease") {
        return runGitLease(options);
    }
    if (options.action === "commit") {
        return runGitCommit(options);
    }
    if (options.action === "record-commit") {
        return runGitRecordCommit(options);
    }
    if (options.action === "commit-status") {
        return runGitCommitStatus(options);
    }
    const check = evaluateGitGovernanceCheck({
        cwd: options.cwd,
        actorInput: options.actorId,
        taskId: options.taskId,
        sessionId: options.sessionId,
        requireTrailers: options.checkTrailers,
    });
    return makeResult({
        ok: check.ok,
        command: "git",
        cwd: options.cwd,
        messages: [
            check.ok
                ? message("info", "ATM_GIT_CHECK_OK", "Git governance checks passed.")
                : message("error", "ATM_GIT_CHECK_FAILED", "Git governance checks failed.", { violations: check.violations }),
        ],
        evidence: {
            action: "check",
            requiredTrailers: options.checkTrailers,
            actorId: check.actorId,
            taskId: check.taskId,
            claimLeaseId: check.claimLeaseId,
            sessionId: check.sessionId,
            git: { name: check.gitName, email: check.gitEmail },
            trailers: check.trailers,
            violations: check.violations,
        },
    });
}
