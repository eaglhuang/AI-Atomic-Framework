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
import { isProposalLanePrivatePath, isLiveSharedMutationPath } from '../next/proposal-lane.ts';

export function validateProposalLaneDurableRef(filePath: string): { readonly ok: boolean; readonly reason: string } {
  const normalized = String(filePath).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized) return { ok: false, reason: 'Proposal lane durable reference is empty.' };
  if (!isProposalLanePrivatePath(normalized)) {
    return { ok: false, reason: 'Proposal lane durable reference must stay under runtime proposal or evidence paths.' };
  }
  if (isLiveSharedMutationPath(normalized)) {
    return { ok: false, reason: 'Proposal lane durable reference cannot target live shared mutation surfaces.' };
  }
  return { ok: true, reason: 'Proposal lane durable reference is isolated from live shared mutation surfaces.' };
}


export function handleBrokerProposalActions(options: ParsedBrokerOptions) {
  if (options.action === 'proposal') {
    if (!options.proposalAction) {
      throw new CliError('ATM_CLI_USAGE', 'broker proposal requires an action: create | list | show | validate.', { exitCode: 2 });
    }

    const storePath = path.join(options.cwd, options.proposalStorePath ?? defaultBrokerProposalStoreRelativePath);

    if (options.proposalAction === 'create') {
      if (options.proposalIds.length > 0) {
        throw new CliError('ATM_CLI_USAGE', 'broker proposal create does not accept a proposal id.', { exitCode: 2 });
      }
      if (options.proposalFiles.length !== 1) {
        throw new CliError('ATM_CLI_USAGE', 'broker proposal create requires exactly one --proposal-file <path>.', { exitCode: 2 });
      }

      const proposal = readBrokerProposalFile(path.resolve(options.cwd, options.proposalFiles[0]));
      const validation = validateBrokerProposal(proposal, { cwd: options.cwd });
      if (!validation.ok) {
        throw new CliError('ATM_BROKER_PROPOSAL_INVALID', 'Broker proposal failed validation.', {
          exitCode: 1,
          details: { proposalId: proposal.proposalId, issues: validation.issues }
        });
      }

      const updatedStore = upsertBrokerProposalStore(loadBrokerProposalStore(storePath), proposal);
      saveBrokerProposalStore(storePath, updatedStore);

      return makeResult({
        ok: true,
        command: 'broker',
        cwd: options.cwd,
        messages: [
          message('info', 'ATM_BROKER_PROPOSAL_CREATED', `Stored broker proposal ${proposal.proposalId}.`, { proposalId: proposal.proposalId })
        ],
        evidence: {
          action: 'proposal-create',
          storePath: relativeStorePath(options.cwd, storePath),
          proposal,
          validation,
          proposals: listBrokerProposalSummaries(updatedStore)
        }
      });
    }

    if (options.proposalAction === 'list') {
      if (options.proposalFiles.length > 0 || options.proposalIds.length > 0) {
        throw new CliError('ATM_CLI_USAGE', 'broker proposal list does not accept a proposal file or proposal id.', { exitCode: 2 });
      }

      const store = loadBrokerProposalStore(storePath);
      const proposals = listBrokerProposalSummaries(store);
      return makeResult({
        ok: true,
        command: 'broker',
        cwd: options.cwd,
        messages: [message('info', 'ATM_BROKER_PROPOSAL_LISTED', `Listed ${proposals.length} broker proposal(s).`, { proposalCount: proposals.length })],
        evidence: {
          action: 'proposal-list',
          storePath: relativeStorePath(options.cwd, storePath),
          proposals
        }
      });
    }

    if (options.proposalAction === 'show') {
      if (options.proposalFiles.length > 0) {
        throw new CliError('ATM_CLI_USAGE', 'broker proposal show does not accept --proposal-file.', { exitCode: 2 });
      }
      if (options.proposalIds.length !== 1) {
        throw new CliError('ATM_CLI_USAGE', 'broker proposal show requires <proposal-id>.', { exitCode: 2 });
      }

      const proposalId = options.proposalIds[0];
      const store = loadBrokerProposalStore(storePath);
      const proposal = findBrokerProposal(store, proposalId);
      if (!proposal) {
        throw new CliError('ATM_BROKER_PROPOSAL_NOT_FOUND', `Broker proposal not found: ${proposalId}`, {
          exitCode: 2,
          details: {
            proposalId,
            storePath: relativeStorePath(options.cwd, storePath)
          }
        });
      }

      return makeResult({
        ok: true,
        command: 'broker',
        cwd: options.cwd,
        messages: [message('info', 'ATM_BROKER_PROPOSAL_SHOWN', `Loaded broker proposal ${proposalId}.`, { proposalId })],
        evidence: {
          action: 'proposal-show',
          storePath: relativeStorePath(options.cwd, storePath),
          proposal
        }
      });
    }

    if (options.proposalAction === 'validate') {
      if (options.proposalFiles.length > 0 && options.proposalIds.length > 0) {
        throw new CliError('ATM_CLI_USAGE', 'broker proposal validate accepts either --proposal-file or <proposal-id>, not both.', { exitCode: 2 });
      }
      if (options.proposalFiles.length === 0 && options.proposalIds.length === 0) {
        throw new CliError('ATM_CLI_USAGE', 'broker proposal validate requires a proposal file or <proposal-id>.', { exitCode: 2 });
      }

      const proposal = options.proposalFiles.length > 0
        ? readBrokerProposalFile(path.resolve(options.cwd, options.proposalFiles[0]))
        : findBrokerProposal(loadBrokerProposalStore(storePath), options.proposalIds[0]);
      if (!proposal) {
        const proposalId = options.proposalIds[0];
        throw new CliError('ATM_BROKER_PROPOSAL_NOT_FOUND', `Broker proposal not found: ${proposalId}`, {
          exitCode: 2,
          details: {
            proposalId,
            storePath: relativeStorePath(options.cwd, storePath)
          }
        });
      }

      const validation = validateBrokerProposal(proposal, { cwd: options.cwd });
      if (!validation.ok) {
        throw new CliError('ATM_BROKER_PROPOSAL_INVALID', 'Broker proposal failed validation.', {
          exitCode: 1,
          details: { proposalId: proposal.proposalId, issues: validation.issues }
        });
      }

      return makeResult({
        ok: true,
        command: 'broker',
        cwd: options.cwd,
        messages: [message('info', 'ATM_BROKER_PROPOSAL_VALIDATED', `Validated broker proposal ${proposal.proposalId}.`, { proposalId: proposal.proposalId })],
        evidence: {
          action: 'proposal-validate',
          storePath: relativeStorePath(options.cwd, storePath),
          proposal,
          validation
        }
      });
    }

    throw new CliError('ATM_CLI_USAGE', 'broker proposal supports: create, list, show, validate.', { exitCode: 2 });
  }

  return null;
}
