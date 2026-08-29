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
import { assertEmergencyApproval, recordProtectedOverrideOutcome, requireConsumedEmergencyApproval } from '../../emergency/gate.ts';
import { GIT_INDEX_LOCK_RECOVERY_FLAG, recoverGitIndexLock } from './git-index-lock-recovery.ts';
import { recoverLiveIndexAfterSuccessfulCommit } from './live-index-reconciliation.ts';
import { drainLiveIndexReconciliationReceipt } from './live-index-drain.ts';

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
  if (options.action === 'reconcile-live-index') {
    // Without a commit sha the durable receipt is the addressable input: it is
    // the record of the debt, so it is also sufficient to drain it. This is the
    // route for debt that accumulated across commits, where no single commit's
    // parent tree describes the live index any more.
    if (!options.commitSha && options.taskId) {
      const dryRun = options.write !== true || options.dryRun === true;
      const drain = drainLiveIndexReconciliationReceipt({
        cwd: options.cwd,
        taskId: options.taskId,
        dryRun
      });
      return makeResult({
        ok: drain.clean || dryRun,
        command: 'git',
        cwd: options.cwd,
        messages: [
          message(
            drain.clean ? 'info' : 'warning',
            dryRun ? 'ATM_LIVE_INDEX_DRAIN_DRY_RUN' : 'ATM_LIVE_INDEX_DRAIN_APPLIED',
            dryRun
              ? 'Receipt-scoped live-index drain dry-run completed without mutating the index.'
              : 'Receipt-scoped live-index drain advanced only paths whose recorded pre-state was still provable.',
            { drain }
          )
        ],
        evidence: { action: 'reconcile-live-index', drain }
      });
    }
    if (!options.commitSha) {
      throw new CliError(
        'ATM_CLI_USAGE',
        'git reconcile-live-index requires --commit <sha>, or --task <id> to drain that task\'s reconciliation receipt.',
        { exitCode: 2 }
      );
    }
    const dryRun = options.write !== true || options.dryRun === true;
    const recovery = recoverLiveIndexAfterSuccessfulCommit({
      cwd: options.cwd,
      commitSha: options.commitSha,
      dryRun
    });
    return makeResult({
      ok: recovery.clean || dryRun,
      command: 'git',
      cwd: options.cwd,
      messages: [
        message(
          recovery.clean ? 'info' : 'warning',
          dryRun ? 'ATM_LIVE_INDEX_RECOVERY_DRY_RUN' : 'ATM_LIVE_INDEX_RECOVERY_APPLIED',
          dryRun
            ? 'Historical live-index recovery dry-run completed without mutating the index.'
            : 'Historical live-index recovery applied only proven parent-blob residue.',
          { recovery }
        )
      ],
      evidence: { action: 'reconcile-live-index', recovery }
    });
  }
  if (options.action === 'recover-index-lock') {
    const command = `node atm.mjs git recover-index-lock --task ${quoteCliValue(options.taskId ?? '<task-id>')} --actor ${quoteCliValue(options.actorId ?? '<actor-id>')} ${GIT_INDEX_LOCK_RECOVERY_FLAG} --emergency-approval <lease-id> --reason "<human-approved reason>" --json`;
    const approval = requireConsumedEmergencyApproval(assertEmergencyApproval({
      cwd: options.cwd,
      surface: 'git recover-index-lock',
      permission: 'backend.gitIndexLockRecovery',
      taskId: options.taskId,
      actorId: options.actorId,
      emergencyApproval: options.emergencyApproval,
      flags: [GIT_INDEX_LOCK_RECOVERY_FLAG],
      reason: options.overrideReason,
      command,
    }));
    try {
      const recovery = recoverGitIndexLock({
        cwd: options.cwd,
        force: options.forceIndexLockRecovery,
        dryRun: options.dryRun,
      });
      if (approval) {
        recordProtectedOverrideOutcome({
          cwd: options.cwd,
          parentEventId: approval.protectedOverrideAudit.event.eventId,
          actorId: options.actorId,
          taskId: options.taskId,
          surface: 'git recover-index-lock',
          command,
          flags: [GIT_INDEX_LOCK_RECOVERY_FLAG],
          permission: 'backend.gitIndexLockRecovery',
          leaseId: options.emergencyApproval,
          reason: options.overrideReason,
          skippedChecks: ['active-git-writer-liveness-is-human-confirmed'],
          touchedFiles: recovery.action === 'removed' ? [relativePathFrom(options.cwd, recovery.before.lockPath)] : [],
          outcome: 'succeeded',
          emergencyUsePath: approval.usePath,
        });
      }
      return makeResult({
        ok: true,
        command: 'git',
        cwd: options.cwd,
        messages: [message('info', 'ATM_GIT_INDEX_LOCK_RECOVERY_READY', `Git index lock recovery ${recovery.action}.`, { recovery })],
        evidence: { action: 'recover-index-lock', recovery, emergencyUse: approval ?? null },
      });
    } catch (error) {
      if (approval) {
        recordProtectedOverrideOutcome({
          cwd: options.cwd,
          parentEventId: approval.protectedOverrideAudit.event.eventId,
          actorId: options.actorId,
          taskId: options.taskId,
          surface: 'git recover-index-lock',
          command,
          flags: [GIT_INDEX_LOCK_RECOVERY_FLAG],
          permission: 'backend.gitIndexLockRecovery',
          leaseId: options.emergencyApproval,
          reason: options.overrideReason,
          skippedChecks: ['active-git-writer-liveness-is-human-confirmed'],
          touchedFiles: [],
          outcome: 'failed',
          failureCode: error instanceof CliError ? error.code : 'ATM_GIT_INDEX_LOCK_PRESENT',
          emergencyUsePath: approval.usePath,
        });
      }
      throw error;
    }
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
