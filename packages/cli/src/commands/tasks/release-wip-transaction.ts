import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { planWipTransition, retainReleasedWipOwnership } from '../../../../core/src/lane/wip-ownership-transition.ts';
import { CliError } from '../shared.ts';
import { readClaimLaneSessionId } from './claim-ownership.ts';
import { runAtmGit } from '../git-governance.ts';

export function isConfirmedWipCommitResult(result: any): boolean {
  const evidence = result?.evidence && typeof result.evidence === 'object' ? result.evidence as Record<string, any> : null;
  const decision = evidence?.workAdmission?.decision && typeof evidence.workAdmission.decision === 'object' ? evidence.workAdmission.decision as Record<string, any> : null;
  return result?.ok === true && decision?.ok !== false && typeof evidence?.commitSha === 'string' && evidence.commitSha.trim().length > 0;
}

export async function prepareReleaseWip(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly currentClaim: Record<string, any> | null;
  readonly taskDocument: Record<string, any>;
  readonly dirtyInScopeFiles: readonly string[];
  readonly discardWip: boolean;
  readonly wipCommit: boolean;
  readonly reason: string | null;
  readonly nowIso: string;
}): Promise<{ readonly wipCommitReceipt: Record<string, unknown> | null; readonly discardWipReceipt: Record<string, unknown> | null }> {
  let wipCommitReceipt: Record<string, unknown> | null = null;
  let discardWipReceipt: Record<string, unknown> | null = null;
  if (input.dirtyInScopeFiles.length > 0) {
    if (input.discardWip) {
      const discardWipReceiptPath = `.atm/history/evidence/${input.taskId}.discard-wip-receipt.json`;
      discardWipReceipt = { schemaId: 'atm.discardWipReceipt.v1', specVersion: '0.1.0', taskId: input.taskId, actorId: input.actorId, timestamp: input.nowIso, discardedFiles: input.dirtyInScopeFiles, reason: input.reason ?? 'discard WIP on claim release' };
      const absoluteDiscardPath = path.resolve(input.cwd, discardWipReceiptPath);
      mkdirSync(path.dirname(absoluteDiscardPath), { recursive: true });
      writeFileSync(absoluteDiscardPath, `${JSON.stringify(discardWipReceipt, null, 2)}\n`, 'utf8');
      for (const file of input.dirtyInScopeFiles) {
        const relPath = file.replace(/\\/g, '/');
        try { execFileSync('git', ['-C', input.cwd, 'checkout', 'HEAD', '--', relPath], { stdio: 'pipe', encoding: 'utf8' }); } catch { rmSync(path.resolve(input.cwd, relPath), { force: true }); }
      }
    } else if (input.wipCommit) {
      const gitResult = await runAtmGit(['commit', '--cwd', input.cwd, '--actor', input.actorId, '--task', input.taskId, '--message', `wip: ${input.taskId} non-delivery WIP commit`, '--wip', '--auto-stage', '--json']);
      const evidence = gitResult?.evidence && typeof gitResult.evidence === 'object' ? gitResult.evidence as Record<string, any> : null;
      const commitSha = typeof evidence?.commitSha === 'string' ? evidence.commitSha.trim() : '';
      if (!isConfirmedWipCommitResult(gitResult)) throw new CliError('ATM_RELEASE_DIRTY_WIP_BLOCKED', `WIP preservation for ${input.taskId} did not produce a governed commit SHA; claim release was not applied.`, { exitCode: 1, details: { taskId: input.taskId, actorId: input.actorId, failureKind: 'preservation-commit-not-confirmed', committedFiles: input.dirtyInScopeFiles, gitResult: gitResult?.evidence ?? null } });
      wipCommitReceipt = { schemaId: 'atm.wipCommitReceipt.v1', taskId: input.taskId, actorId: input.actorId, timestamp: input.nowIso, committedFiles: input.dirtyInScopeFiles, commitSha, gitResult: gitResult.evidence };
    } else {
      const recoveryCommands = { finishAndClose: `node atm.mjs taskflow close --task ${input.taskId} --actor ${input.actorId} --json`, nonDeliveryWipCommitAndRelease: `node atm.mjs tasks release --task ${input.taskId} --actor ${input.actorId} --wip-commit --reason "${input.reason ?? 'WIP preservation'}" --json`, discardAndRelease: `node atm.mjs tasks release --task ${input.taskId} --actor ${input.actorId} --discard-wip --reason "${input.reason ?? 'discard WIP'}" --json` };
      throw new CliError('ATM_RELEASE_DIRTY_WIP_BLOCKED', `tasks release for ${input.taskId} blocked because ${input.dirtyInScopeFiles.length} in-scope source file(s) are dirty: ${input.dirtyInScopeFiles.join(', ')}. Clean or preserve WIP before releasing.`, { exitCode: 1, details: { taskId: input.taskId, actorId: input.actorId, dirtyInScopeFiles: input.dirtyInScopeFiles, recoveryCommands, requiredCommand: recoveryCommands.nonDeliveryWipCommitAndRelease } });
    }
  }
  const laneSessionId = readClaimLaneSessionId(input.currentClaim);
  const plan = planWipTransition({ kind: 'release', taskId: input.taskId, requestingLaneId: laneSessionId ?? '', actorId: input.actorId, dirtyPaths: wipCommitReceipt || discardWipReceipt ? [] : input.dirtyInScopeFiles, now: input.nowIso }, { taskId: input.taskId, ownerLaneId: laneSessionId, recordedDirtyPaths: input.dirtyInScopeFiles, journalHead: 0 });
  if (!plan.allowed || plan.ownerless) throw new CliError('ATM_RELEASE_DIRTY_WIP_BLOCKED', `Release for ${input.taskId} would leave dirty WIP without a durable owner; claim release was not applied.`, { exitCode: 1, details: { taskId: input.taskId, actorId: input.actorId, failureKind: 'ownership-transition-not-safe', dirtyInScopeFiles: input.dirtyInScopeFiles, transition: plan } });
  if (plan.dirtyPathCount > 0) {
    const retainedWip = retainReleasedWipOwnership({ plan, actorId: input.actorId, laneSessionId, dirtyPaths: input.dirtyInScopeFiles });
    if (!retainedWip) throw new CliError('ATM_RELEASE_DIRTY_WIP_BLOCKED', `Release for ${input.taskId} could not persist retained WIP ownership; claim release was not applied.`, { exitCode: 1, details: { taskId: input.taskId, actorId: input.actorId, failureKind: 'ownership-retention-not-confirmed', dirtyInScopeFiles: input.dirtyInScopeFiles, transition: plan } });
    input.taskDocument.wipOwnership = retainedWip;
  }
  return { wipCommitReceipt, discardWipReceipt };
}
