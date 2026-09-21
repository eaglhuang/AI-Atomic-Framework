/**
 * Shared-delivery commit transaction ordering.
 *
 * The broker used to assemble a tree, create a commit object and move `HEAD`,
 * and only afterwards ask whether the shared-delivery plan was admissible. A
 * rejected plan therefore reported `ok: false` while the ref had already
 * advanced — the caller was told the write did not happen, and it had.
 *
 * This module owns the correct order for the commit surface:
 *
 *   1. plan and admit against the pre-apply HEAD;
 *   2. only if admitted, seal the payload and build the candidate tree;
 *   3. prove the candidate equals the seal;
 *   4. move the ref;
 *   5. re-derive the receipt from the tree that actually landed.
 *
 * Steps 1 to 3 have no ref side effect, so any rejection leaves HEAD where it
 * was. The wait/retry decision for a moved HEAD stays with the broker queue —
 * this module only reports the CAS mismatch rather than forcing past it.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CliError } from '../shared.ts';
import {
  planSharedDeliveryCommit,
  type SharedDeliveryCommitInput,
  type SharedDeliveryCommitPlan
} from '../../../../core/src/broker/shared-delivery-commit.ts';
import { assembleSealedCommitIndex, assertCommitAttribution, readCandidateTreeEntries, readCommittedTreeEntries, sealCommitBundleFromLiveIndex } from '../git-governance/implementation/sealed-commit-attribution.ts';
import { assertRecordCommitPayloadPresent } from '../git-governance/record-commit-payload-assertion.ts';


export const ATM_BROKER_BATCH_COMMIT_BLOCKED = 'ATM_BROKER_BATCH_COMMIT_BLOCKED' as const;
export const ATM_BROKER_BATCH_COMMIT_HEAD_MOVED = 'ATM_BROKER_BATCH_COMMIT_HEAD_MOVED' as const;

function runGit(cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv): string {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    throw new CliError(ATM_BROKER_BATCH_COMMIT_BLOCKED, `git ${args.join(' ')} failed while executing shared delivery commit.`, {
      exitCode: 1,
      details: { args, stdout: result.stdout, stderr: result.stderr }
    });
  }
  return String(result.stdout ?? '').trim();
}

export interface SharedDeliveryApplyOutcome {
  readonly commitSha: string;
  readonly committedFiles: readonly string[];
  readonly attributionProof: ReturnType<typeof assertCommitAttribution>;
  readonly payloadAssertion: ReturnType<typeof assertRecordCommitPayloadPresent>;
}

/**
 * Assemble, prove, then move the ref. `commit-tree` writes an object but does
 * not publish it; `update-ref` is the only step with an observable effect, and
 * it runs last and with a compare-and-swap against the expected HEAD.
 */
export function applySealedSharedDeliveryCommit(input: {
  readonly cwd: string;
  readonly actorId: string;
  readonly taskIds: readonly string[];
  readonly expectedHeadSha: string;
  readonly files: readonly string[];
}): SharedDeliveryApplyOutcome {
  const files = [...new Set(input.files.map((file) => file.replace(/\\/g, '/').trim()).filter(Boolean))].sort();
  if (files.length === 0) {
    throw new CliError(ATM_BROKER_BATCH_COMMIT_BLOCKED, 'Shared delivery commit apply requires at least one payload file.', {
      exitCode: 1,
      details: { taskIds: input.taskIds }
    });
  }
  const bundle = sealCommitBundleFromLiveIndex({ cwd: input.cwd, paths: files, provenance: 'shared-delivery-slice' });
  const tempDir = mkdtempSync(path.join(tmpdir(), 'atm-shared-delivery-index-'));
  const env = { GIT_INDEX_FILE: path.join(tempDir, 'index') };
  try {
    assembleSealedCommitIndex({ cwd: input.cwd, bundle, env, baseRef: input.expectedHeadSha });
    const attributionProof = assertCommitAttribution({
      sealed: bundle,
      actual: readCandidateTreeEntries({ cwd: input.cwd, env, baseRef: input.expectedHeadSha, sealedPaths: bundle.entries.map((entry) => entry.path) }),
      surface: 'broker batch execute --surface commit --apply',
      actorId: input.actorId
    });
    const treeSha = runGit(input.cwd, ['write-tree'], env);
    const headTreeSha = runGit(input.cwd, ['rev-parse', `${input.expectedHeadSha}^{tree}`]);
    if (treeSha === headTreeSha) {
      throw new CliError(ATM_BROKER_BATCH_COMMIT_BLOCKED, 'Shared delivery commit payload produced no tree changes.', {
        exitCode: 1,
        details: { taskIds: input.taskIds, files }
      });
    }
    const commitSha = runGit(input.cwd, [
      'commit-tree',
      treeSha,
      '-p',
      input.expectedHeadSha,
      '-m',
      `shared-delivery: commit ${input.taskIds.join(', ')}`
    ], {
      ...env,
      GIT_AUTHOR_NAME: input.actorId,
      GIT_AUTHOR_EMAIL: `${input.actorId}@atm.local`,
      GIT_COMMITTER_NAME: input.actorId,
      GIT_COMMITTER_EMAIL: `${input.actorId}@atm.local`
    });
    // Compare-and-swap: git refuses the update when another lane advanced HEAD
    // after the plan was admitted, which is the broker's signal to requeue.
    assertHeadUnmovedThenUpdate({ cwd: input.cwd, commitSha, expectedHeadSha: input.expectedHeadSha, taskIds: input.taskIds });
    return {
      commitSha,
      committedFiles: readCommittedTreeEntries(input.cwd, commitSha).map((entry) => entry.path),
      attributionProof,
      payloadAssertion: assertRecordCommitPayloadPresent({
        cwd: input.cwd,
        commitSha,
        expectedStagedFiles: files
      })
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function assertHeadUnmovedThenUpdate(input: {
  readonly cwd: string;
  readonly commitSha: string;
  readonly expectedHeadSha: string;
  readonly taskIds: readonly string[];
}): void {
  const result = spawnSync('git', ['update-ref', 'HEAD', input.commitSha, input.expectedHeadSha], {
    cwd: input.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status === 0) return;
  throw new CliError(ATM_BROKER_BATCH_COMMIT_HEAD_MOVED, 'HEAD moved after this shared delivery plan was admitted; the commit object was written but not published.', {
    exitCode: 1,
    details: {
      taskIds: input.taskIds,
      expectedHeadSha: input.expectedHeadSha,
      unpublishedCommitSha: input.commitSha,
      stderr: result.stderr,
      safeNextActions: ['requeue-through-the-broker-and-re-plan-against-the-new-head'],
      requiredCommand: 'node atm.mjs broker batch execute --surface commit --json'
    }
  });
}

export interface SharedDeliveryCommitTransaction {
  readonly plan: SharedDeliveryCommitPlan;
  readonly applied: SharedDeliveryApplyOutcome | null;
  readonly admissionPlan: SharedDeliveryCommitPlan;
  readonly headMoved: boolean;
}

/**
 * Admission first, side effect second. `planInput` describes the transaction
 * as it would land; the pre-apply pass runs it with no commit sha so a
 * rejection is observed before any object or ref is written.
 */
export function runSharedDeliveryCommitTransaction(input: {
  readonly cwd: string;
  readonly apply: boolean;
  readonly actorId: string;
  readonly taskIds: readonly string[];
  readonly expectedHeadSha: string;
  readonly payloadFiles: readonly string[];
  readonly planInput: Omit<SharedDeliveryCommitInput, 'commitSha' | 'committedFiles'>;
}): SharedDeliveryCommitTransaction {
  const admissionPlan = planSharedDeliveryCommit({ ...input.planInput, commitSha: null });
  if (!input.apply || !admissionPlan.ok) {
    return { plan: admissionPlan, admissionPlan, applied: null, headMoved: false };
  }
  const applied = applySealedSharedDeliveryCommit({
    cwd: input.cwd,
    actorId: input.actorId,
    taskIds: input.taskIds,
    expectedHeadSha: input.expectedHeadSha,
    files: input.payloadFiles
  });
  const plan = planSharedDeliveryCommit({
    ...input.planInput,
    currentHeadSha: applied.commitSha,
    expectedHeadSha: null,
    commitSha: applied.commitSha,
    committedFiles: applied.committedFiles
  });
  return { plan, admissionPlan, applied, headMoved: true };
}
