import {
  evaluateGitGovernanceCheck,
  runGitCommitStatus,
  runGitPrepare,
} from './identity-check-command.ts';

import {
  CliError,
  makeResult,
  message,
  quoteCliValue,
  relativePathFrom,
} from "../../shared.ts";

import { runGitAdmission } from './admission-command.ts';

import { runGitCommit } from './commit-command.ts';

import { parseGitOptions } from './git-command-options.ts';

import { runGitLease } from './lease-command.ts';

import { runGitPostPushFailRecovery, runGitPush } from './push-command.ts';

import { runGitRecordCommit } from './record-commit-command.ts';

type LegacyValue = ReturnType<typeof JSON.parse>;



export function normalizeCommitLaneSessionId(value: LegacyValue) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function laneSessionIdFromRecord(value: LegacyValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value;
  return normalizeCommitLaneSessionId(record.laneSessionId);
}

export function resolveCommitLaneSessionId(input: LegacyValue = {}) {
  const env = input.env ?? process.env;
  const envRecord = env && typeof env === "object" ? env : {};
  return (
    normalizeCommitLaneSessionId(envRecord.ATM_COMMIT_LANE_SESSION_ID) ??
    normalizeCommitLaneSessionId(envRecord.ATM_LANE_SESSION_ID) ??
    laneSessionIdFromRecord(input.claim?.laneSession) ??
    laneSessionIdFromRecord(input.laneSession) ??
    normalizeCommitLaneSessionId(input.session?.guidanceSessionId) ??
    null
  );
}

export async function runAtmGit(argv: LegacyValue) {
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
        : message(
            "error",
            "ATM_GIT_CHECK_FAILED",
            "Git governance checks failed.",
            { violations: check.violations },
          ),
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
