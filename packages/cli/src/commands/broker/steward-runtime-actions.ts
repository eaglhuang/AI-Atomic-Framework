// @ts-nocheck
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CliError, makeResult, message } from '../shared.ts';
import {
  loadRegistry,
  saveRegistry,
  registerIntent,
  renewIntentLease,
  releaseTask,
  cleanupStale
} from '../../../../core/src/broker/registry.ts';
import { cleanupBrokerRuntimeSnapshots } from '../../../../core/src/broker/lifecycle.ts';
import { calculateBrokerDecision } from '../../../../core/src/broker/decision.ts';
import { composeBrokerProposals } from '../../../../core/src/broker/compose.ts';
import { applyStewardPlan, executeBrokerScopedWrite, planStewardApply } from '../../../../core/src/broker/steward.ts';
import { buildTeamBrokerRuntimeActivationHandshake, buildTeamBrokerRunRecord, buildTeamBrokerRunRecordEnvelope, projectTeamBrokerRearbitrationSnapshot } from '../../../../core/src/broker/team-lane.ts';
import { defaultBrokerProposalStoreRelativePath, findBrokerProposal, listBrokerProposalSummaries, loadBrokerProposalStore, readBrokerProposalFile, saveBrokerProposalStore, upsertBrokerProposalStore, validateBrokerProposal } from '../../../../core/src/broker/proposal.ts';
import { defaultAdapterRegistry, resolveAdapter } from '../../../../core/src/broker/adapters/registry.ts';
import { planMutationBatch } from '../../../../core/src/broker/adapters/batch-planner.ts';
import { computeCasResult, hashContent } from '../../../../core/src/broker/adapters/cas.ts';
import { enqueueSharedSurface, planSharedSurfaceAcquisition, removeSharedSurfaceEntry, type SharedSurfaceQueue } from '../../../../core/src/broker/shared-surface-queue.ts';
import { cleanupRunnerSyncStewardQueue, emptyRunnerSyncStewardQueue, enqueueRunnerSyncStewardRequest, explainRunnerSyncStewardPosition, releaseRunnerSyncStewardQueue, type RunnerSyncStewardQueueDocument } from '../../../../core/src/broker/runner-sync-steward-queue.ts';
import { cleanupGeneratedProjectionSteward, emptyGeneratedProjectionSteward, enqueueGeneratedProjectionRebuild, type GeneratedProjectionStewardDocument } from '../../../../core/src/broker/generated-projection-steward.ts';
import { acknowledgeFreeze, createFreezeSignal, resolveFreezeDecision, type FreezeAck, type FreezeResolution, type FreezeSignal } from '../../../../core/src/broker/freeze.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, BrokerMutationEvidenceEntry, MergePlan, MutationRequest, PatchProposal, WriteIntent, ConflictKey, BrokerOperationRunRecord, ExplicitMutationIntentInputSummary, ExplicitMutationIntentKind, MutationIntentMissingInput } from '../../../../core/src/broker/types.ts';
import type { BrokerCommandContext } from './types.ts';
import type { ParsedBrokerOptions } from './parser.ts';
import { readSharedSurfaceFreezeRecords, writeSharedSurfaceFreezeRecords, readSharedSurfaceQueues, writeSharedSurfaceQueues, readRunnerSyncStewardQueue, writeRunnerSyncStewardQueue, toRunnerSyncReleaseCliError, readGeneratedProjectionSteward, writeGeneratedProjectionSteward } from './persistence.ts';
import { updateSharedSurfaceQueues, createSharedSurfaceFreezeRecords, markReleasedSharedSurfaceFreezes, shouldQueueSharedSurface, resolveSharedSurfaceQueueAdmission, replaceIntentLane, assertBrokerRegisterCliParity, syncTeamRunRearbitrationSnapshots } from './shared-surface.ts';
import { loadComposeProposals, relativeStorePath, resolveBrokerRunEvidenceDir, normalizeEvidencePath } from './parser.ts';
import { classifyExplicitMutationRequest, buildMutationEvidence, extractMutationRequestTransactionIds } from './mutation-helpers.ts';


export function handleBrokerStewardRuntimeActions(options: ParsedBrokerOptions, context: BrokerCommandContext) {
  const registryPath = context.registryPath;
  if (options.action === 'steward') {
    if (!options.stewardAction) {
      throw new CliError('ATM_CLI_USAGE', 'broker steward requires an action: plan | apply.', { exitCode: 2 });
    }
    if (!options.mergePlanFile) {
      throw new CliError('ATM_CLI_USAGE', 'broker steward requires --merge-plan-file <path>.', { exitCode: 2 });
    }

    const mergePlanPath = path.resolve(options.cwd, options.mergePlanFile);
    if (!existsSync(mergePlanPath)) {
      throw new CliError('ATM_FILE_NOT_FOUND', `Merge plan file not found: ${options.mergePlanFile}`, { exitCode: 1 });
    }
    const mergePlan = JSON.parse(readFileSync(mergePlanPath, 'utf8')) as MergePlan;
    const proposals = loadComposeProposals(options);
    const stewardId = options.stewardId ?? 'neutral-write-steward';
    const scopeFiles = options.scopeFiles.length > 0
      ? options.scopeFiles
      : [...new Set(proposals.map((proposal) => proposal.targetFile))];

    if (options.stewardAction === 'plan') {
      const planResult = planStewardApply({
        cwd: options.cwd,
        stewardId,
        mergePlan,
        proposals,
        scopeFiles
      });
      return makeResult({
        ok: planResult.ok,
        command: 'broker',
        cwd: options.cwd,
        messages: [
          message(
            planResult.ok ? 'info' : 'error',
            planResult.ok ? 'ATM_BROKER_STEWARD_PLANNED' : 'ATM_BROKER_STEWARD_PLAN_BLOCKED',
            planResult.ok
              ? `Steward plan '${planResult.plan.mergePlanId}' is ready to apply.`
              : 'Steward plan blocked by validation issues.',
            { mergePlanId: mergePlan.mergePlanId, issueCount: planResult.plan.issues.length }
          )
        ],
        evidence: {
          action: 'steward-plan',
          stewardId,
          plan: planResult.plan,
          mergePlan,
          proposalCount: proposals.length
        }
      });
    }

    if (options.stewardAction === 'apply') {
      const evidenceOutPath = options.evidenceOutPath
        ? path.resolve(options.cwd, options.evidenceOutPath)
        : null;
      const taskId = options.task ?? proposals[0]?.taskId ?? null;
      const actorId = options.actorId ?? proposals[0]?.actorId ?? null;
      const taskPath = taskId ? path.join(options.cwd, '.atm', 'history', 'tasks', `${taskId}.json`) : null;
      const hasRuntimeActivationInputs = Boolean(taskId && actorId && taskPath && existsSync(taskPath));

      const directApplyResult = hasRuntimeActivationInputs
        ? null
        : applyStewardPlan({
            cwd: options.cwd,
            stewardId,
            mergePlan,
            proposals,
            scopeFiles,
            evidenceOutPath
          });
      const runtimeActivationHandshake = hasRuntimeActivationInputs
        ? buildTeamBrokerRuntimeActivationHandshake({
            cwd: options.cwd,
            taskId: taskId as string,
            actorId: actorId as string,
            task: JSON.parse(readFileSync(taskPath as string, 'utf8')) as Record<string, unknown>,
            writePaths: scopeFiles,
            registryPath
          }).evidence
        : null;
      const scopedWriteExecution = hasRuntimeActivationInputs && runtimeActivationHandshake
        ? executeBrokerScopedWrite({
            cwd: options.cwd,
            stewardId,
            mergePlan,
            proposals,
            scopeFiles,
            handshake: runtimeActivationHandshake,
            evidenceOutPath
          })
        : null;
      const applyEvidence = hasRuntimeActivationInputs
        ? scopedWriteExecution?.evidence.applyEvidence ?? null
        : directApplyResult?.evidence ?? null;
      const ok = hasRuntimeActivationInputs
        ? scopedWriteExecution?.ok ?? false
        : directApplyResult?.ok ?? false;
      const appliedFileCount = hasRuntimeActivationInputs
        ? scopedWriteExecution?.evidence.applyEvidence?.appliedFiles.length ?? 0
        : directApplyResult?.evidence.appliedFiles.length ?? 0;

      return makeResult({
        ok,
        command: 'broker',
        cwd: options.cwd,
        messages: [
          message(
            ok ? 'info' : 'error',
            ok ? 'ATM_BROKER_STEWARD_APPLIED' : 'ATM_BROKER_STEWARD_APPLY_BLOCKED',
            ok
              ? `Steward applied merge plan '${mergePlan.mergePlanId}' to scoped files.`
              : 'Steward apply blocked; no scoped file writes were performed.',
            {
              mergePlanId: mergePlan.mergePlanId,
              appliedFileCount
            }
          )
        ],
        evidence: {
          action: 'steward-apply',
          stewardId,
          applyEvidence,
          scopedWriteExecution: scopedWriteExecution?.evidence ?? null,
          evidenceOutPath: evidenceOutPath ? path.relative(options.cwd, evidenceOutPath) : null,
          mergePlan,
          proposalCount: proposals.length
        }
      });
    }

    throw new CliError('ATM_CLI_USAGE', 'broker steward supports: plan, apply.', { exitCode: 2 });
  }

  if (options.action === 'runtime') {
    if (options.runtimeAction !== 'activate') {
      throw new CliError('ATM_CLI_USAGE', 'broker runtime requires an action: activate.', { exitCode: 2 });
    }
    if (!options.task) {
      throw new CliError('ATM_CLI_USAGE', 'broker runtime activate requires --task <task-id>.', { exitCode: 2 });
    }
    if (!options.actorId) {
      throw new CliError('ATM_CLI_USAGE', 'broker runtime activate requires --actor <actor-id>.', { exitCode: 2 });
    }
    if (options.scopeFiles.length === 0) {
      throw new CliError('ATM_CLI_USAGE', 'broker runtime activate requires at least one --scope-file <path>.', { exitCode: 2 });
    }

    const taskPath = path.join(options.cwd, '.atm', 'history', 'tasks', `${options.task}.json`);
    if (!existsSync(taskPath)) {
      throw new CliError('ATM_TASK_NOT_FOUND', `Task not found: ${options.task}`, {
        exitCode: 2,
        details: { taskPath: path.relative(options.cwd, taskPath).replace(/\\/g, '/') }
      });
    }
    const task = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
    const activationProposal = options.proposalFiles.length === 1
      ? readBrokerProposalFile(path.resolve(options.cwd, options.proposalFiles[0]))
      : null;
    if (activationProposal) {
      const validation = validateBrokerProposal(activationProposal, { cwd: options.cwd });
      const requestedScope = new Set(options.scopeFiles.map((entry) => entry.replace(/\\/g, '/')));
      if (!validation.ok || activationProposal.taskId !== options.task || activationProposal.actorId !== options.actorId || !requestedScope.has(activationProposal.targetFile)) {
        throw new CliError('ATM_BROKER_RUNTIME_PROPOSAL_INVALID', 'Runtime activation requires one validated proposal owned by the task/actor and covering the requested scope.', { exitCode: 1 });
      }
      task.proposalAdmission = {
        trigger: 'hot-file',
        summarySubmitted: true,
        hotFiles: [activationProposal.targetFile],
        notes: `Validated broker proposal ${activationProposal.proposalId} admitted for runtime activation.`
      };
    }
    const handshake = buildTeamBrokerRuntimeActivationHandshake({
      cwd: options.cwd,
      taskId: options.task,
      actorId: options.actorId,
      task,
      writePaths: options.scopeFiles,
      registryPath
    });

    if (!handshake.ok) {
      return makeResult({
        ok: false,
        command: 'broker',
        cwd: options.cwd,
        messages: [
          message('error', 'ATM_BROKER_RUNTIME_ACTIVATION_BLOCKED', 'Broker runtime activation handshake blocked.', {
            taskId: options.task,
            reasonCount: handshake.evidence.blockedReasons.length
          })
        ],
        evidence: {
          action: 'runtime-activate',
          handshake: handshake.evidence,
          runtimeWritten: false,
          scopedWriteExecuted: false
        }
      });
    }

    if (!options.mergePlanFile) {
      return makeResult({
        ok: true,
        command: 'broker',
        cwd: options.cwd,
        messages: [
          message('info', 'ATM_BROKER_RUNTIME_ACTIVATION_READY', 'Broker runtime activation handshake approved; no scoped write was requested.', {
            taskId: options.task,
            actorId: options.actorId
          })
        ],
        evidence: {
          action: 'runtime-activate',
          handshake: handshake.evidence,
          runtimeWritten: false,
          scopedWriteExecuted: false
        }
      });
    }

    const mergePlanPath = path.resolve(options.cwd, options.mergePlanFile);
    if (!existsSync(mergePlanPath)) {
      throw new CliError('ATM_FILE_NOT_FOUND', `Merge plan file not found: ${options.mergePlanFile}`, { exitCode: 1 });
    }
    const mergePlan = JSON.parse(readFileSync(mergePlanPath, 'utf8')) as MergePlan;
    const proposals = loadComposeProposals(options);
    const stewardId = options.stewardId ?? 'neutral-write-steward';
    const applyResult = executeBrokerScopedWrite({
      cwd: options.cwd,
      stewardId,
      mergePlan,
      proposals,
      scopeFiles: options.scopeFiles,
      handshake: handshake.evidence,
      evidenceOutPath: options.evidenceOutPath ? path.resolve(options.cwd, options.evidenceOutPath) : null
    });

    return makeResult({
      ok: applyResult.ok,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message(
          applyResult.ok ? 'info' : 'error',
          applyResult.ok ? 'ATM_BROKER_RUNTIME_SCOPED_WRITE_APPLIED' : 'ATM_BROKER_RUNTIME_SCOPED_WRITE_BLOCKED',
          applyResult.ok
            ? `Broker runtime scoped write applied for task ${options.task}.`
            : 'Broker runtime scoped write blocked; no scoped file writes were performed.',
          {
            taskId: options.task,
            mergePlanId: mergePlan.mergePlanId,
            applied: applyResult.ok
          }
        )
      ],
      evidence: {
        action: 'runtime-activate',
        handshake: handshake.evidence,
        scopedWriteExecution: applyResult.evidence,
        runtimeWritten: true,
        scopedWriteExecuted: applyResult.ok,
        mergePlan,
        proposalCount: proposals.length
      }
    });
  }

  if (options.action === 'compose') {
    const proposals = loadComposeProposals(options);
    const composeResult = composeBrokerProposals(proposals);
    const blocked = composeResult.mergePlan.verdict === 'blocked-cid-conflict'
      || composeResult.mergePlan.verdict === 'blocked-shared-surface';

    return makeResult({
      ok: composeResult.ok && !blocked,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message(
          blocked ? 'error' : composeResult.mergePlan.verdict === 'needs-steward' ? 'warn' : 'info',
          blocked ? 'ATM_BROKER_COMPOSE_BLOCKED' : 'ATM_BROKER_COMPOSE_PLANNED',
          blocked
            ? `Broker compose blocked with verdict '${composeResult.mergePlan.verdict}'. In broker-governed conflict domains, broker verdicts override Coordinator decisions; Coordinator must yield and escalate.`
            : `Broker compose produced merge plan '${composeResult.mergePlan.mergePlanId}' with verdict '${composeResult.mergePlan.verdict}'.`,
          {
            mergePlanId: composeResult.mergePlan.mergePlanId,
            verdict: composeResult.mergePlan.verdict,
            proposalCount: proposals.length
          }
        )
      ],
      evidence: {
        action: 'compose',
        mergePlan: composeResult.mergePlan,
        proposalCount: proposals.length,
        proposalIds: composeResult.mergePlan.inputProposals
      }
    });
  }

  return null;
}
