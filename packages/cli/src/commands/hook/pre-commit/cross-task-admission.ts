import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gitHeadEvidencePaths } from '../../git-head-evidence.ts';
import { CliError } from '../../shared.ts';
import {
  classifyBlockLifecycleRecordBundle,
  isRecordCommitBlockBridgeAuthorized,
  recordOnlyClaimScopeExemptCovers,
  RECORD_COMMIT_BLOCK_BRIDGE_AUTH_DIR,
  RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV,
  type RecordCommitBlockBridgeAuthorization
} from '../../git-governance/record-only-block-lifecycle-bridge.ts';
import { readStagedFiles } from './input-state.ts';

/**
 * Cross-task mutation admission at the pre-commit boundary.
 *
 * Two decisions live here because they answer the same question — may this
 * staged set touch another task's records — from two directions: the narrow
 * block-lifecycle bridge that admits one governed record pair, and the refusal
 * that must otherwise be raised. Keeping them together stops the refusal from
 * drifting away from the facts the admission actually established.
 */

// ATM-GOV-0266 hook parity: a governed `git record-commit` may persist exactly
// one already-blocked/released card's ledger plus its matching block event while
// an unrelated framework claim is active. The pre-commit hook consumes the same
// block-lifecycle classifier and only lets that exact pair through when a
// single-use, content-bound authorization artifact — written by the governed
// record-commit path and referenced by a commit-env nonce — proves the context.
// A raw `git commit` of an identical pair has no such artifact and stays blocked
// with `ATM_CROSS_TASK_MUTATION_BLOCKED`.
export function authorizeBlockLifecycleRecordBridge(
  root: string,
  crossTaskBlock: { readonly conflictFiles: readonly string[] }
): { readonly authorized: boolean; readonly reason: string } {
  const stagedFiles = readStagedFiles(root).filter(
    (entry) => entry !== gitHeadEvidencePaths.legacyJson && entry !== gitHeadEvidencePaths.jsonl
  );
  const outcome = classifyBlockLifecycleRecordBundle({
    stagedFiles,
    readLedgerRecord: (bridgeTaskId) => {
      const ledgerPath = path.join(root, '.atm', 'history', 'tasks', `${bridgeTaskId}.json`);
      if (!existsSync(ledgerPath)) return null;
      try {
        const ledgerDoc = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Record<string, unknown>;
        const claim = ledgerDoc.claim && typeof ledgerDoc.claim === 'object'
          ? ledgerDoc.claim as Record<string, unknown>
          : null;
        return {
          workItemId: typeof ledgerDoc.workItemId === 'string' ? ledgerDoc.workItemId : (typeof ledgerDoc.id === 'string' ? ledgerDoc.id : null),
          status: typeof ledgerDoc.status === 'string' ? ledgerDoc.status : '',
          claimState: claim && typeof claim.state === 'string' ? claim.state : null,
          claimActorId: claim && typeof claim.actorId === 'string' ? claim.actorId : null,
          claimLeaseId: claim && typeof claim.leaseId === 'string' ? claim.leaseId : null
        };
      } catch {
        return null;
      }
    },
    readEventRecord: (eventPath) => {
      const eventAbs = path.join(root, eventPath);
      if (!existsSync(eventAbs)) return null;
      try {
        const eventDoc = JSON.parse(readFileSync(eventAbs, 'utf8')) as Record<string, unknown>;
        return {
          taskId: typeof eventDoc.taskId === 'string' ? eventDoc.taskId : null,
          action: typeof eventDoc.action === 'string' ? eventDoc.action : null,
          toStatus: typeof eventDoc.toStatus === 'string' ? eventDoc.toStatus : null,
          actorId: typeof eventDoc.actorId === 'string' ? eventDoc.actorId : null,
          taskPath: typeof eventDoc.taskPath === 'string' ? eventDoc.taskPath : null
        };
      } catch {
        return null;
      }
    }
  });
  if (outcome.kind !== 'eligible') {
    return { authorized: false, reason: `staged set is not an eligible block-lifecycle pair (${outcome.kind})` };
  }
  // The exempt pair must fully cover the flagged conflict; any extra conflicting
  // file keeps the block fail-closed.
  if (!recordOnlyClaimScopeExemptCovers(outcome.exemptPaths, crossTaskBlock.conflictFiles)) {
    return { authorized: false, reason: 'cross-task conflict extends beyond the eligible block-lifecycle pair' };
  }
  const nonce = typeof process.env[RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV] === 'string'
    ? process.env[RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV].trim()
    : '';
  let authorization: RecordCommitBlockBridgeAuthorization | null = null;
  if (nonce.length > 0) {
    const authPath = path.join(root, RECORD_COMMIT_BLOCK_BRIDGE_AUTH_DIR, `${nonce}.json`);
    if (existsSync(authPath)) {
      try {
        authorization = JSON.parse(readFileSync(authPath, 'utf8')) as RecordCommitBlockBridgeAuthorization;
      } catch {
        authorization = null;
      }
    }
  }
  const sha256 = (filePath: string): string => createHash('sha256').update(readFileSync(path.join(root, filePath))).digest('hex');
  const committingActorId = typeof process.env.ATM_COMMIT_ACTOR_ID === 'string' && process.env.ATM_COMMIT_ACTOR_ID.trim().length > 0
    ? process.env.ATM_COMMIT_ACTOR_ID.trim()
    : null;
  return isRecordCommitBlockBridgeAuthorized({
    eligible: outcome,
    authorization,
    committingActorId,
    ledgerSha256: sha256(outcome.ledgerPath),
    eventSha256: sha256(outcome.eventPath),
    nowMs: Date.now()
  });
}

/**
 * ATM-GOV-0369 amendment 1 — raise a refusal that describes what was read.
 *
 * The previous message called every task-history owner "active" and offered
 * handoff, release, or repair-claim. For a closed task with a released claim
 * and a released lock, that description was false and none of those recoveries
 * had an applicable object, so the operator was sent to fix something that did
 * not exist. The wording now follows the ownership state the authority snapshot
 * actually reported.
 */
export function raiseCrossTaskMutationBlock(input: {
  readonly committingTaskId: string | null;
  readonly crossTaskBlock: {
    readonly conflictTaskId: string;
    readonly conflictFiles: readonly string[];
    readonly recoveryLane: string;
    readonly conflicts: readonly { readonly surface: string; readonly ownershipState?: string }[];
  };
}): never {
  const { committingTaskId, crossTaskBlock } = input;
  const ownershipState = crossTaskBlock.conflicts.find(
    (entry) => entry.surface === 'task-history'
  )?.ownershipState ?? null;
  const terminalUnentitled = ownershipState === 'terminal-unentitled';
  const ownershipSummary = terminalUnentitled
    ? `terminal task ${crossTaskBlock.conflictTaskId}, which this claim holds no reconciliation entitlement for,`
    : `active task ${crossTaskBlock.conflictTaskId}`;
  const recovery = terminalUnentitled
    ? 'Claim the successor card that owns this reconciliation and declare these exact paths in its scope, then retry through the governed commit lane.'
    : crossTaskBlock.recoveryLane;
  throw new CliError(
    'ATM_CROSS_TASK_MUTATION_BLOCKED',
    `Cross-task mutation incident detected: files owned by ${ownershipSummary} are mutated. File(s): ${crossTaskBlock.conflictFiles.join(', ')}. Recovery: ${recovery}`,
    {
      exitCode: 1,
      details: {
        taskId: committingTaskId,
        conflictTaskId: crossTaskBlock.conflictTaskId,
        conflictFiles: crossTaskBlock.conflictFiles,
        ownershipState,
        recoveryLane: recovery
      }
    }
  );
}
