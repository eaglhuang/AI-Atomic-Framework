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


export function handleBrokerPlanBatch(options: ParsedBrokerOptions) {
  if (options.action === 'plan-batch') {
    const requestPaths: string[] = [...options.requestFiles.map((file) => path.resolve(options.cwd, file))];
    if (options.requestsDir) {
      const dir = path.resolve(options.cwd, options.requestsDir);
      if (!existsSync(dir)) {
        throw new CliError('ATM_FILE_NOT_FOUND', `Requests dir not found: ${options.requestsDir}`, { exitCode: 1 });
      }
      for (const entry of readdirSync(dir).sort((left, right) => left.localeCompare(right))) {
        if (entry.endsWith('.json')) {
          requestPaths.push(path.join(dir, entry));
        }
      }
    }
    if (requestPaths.length === 0) {
      throw new CliError('ATM_CLI_USAGE', 'broker plan-batch requires --request-file <path> and/or --requests-dir <dir>.', { exitCode: 2 });
    }

    const requests: MutationRequest[] = [];
    const explicitInputs: ExplicitMutationIntentInputSummary[] = [];
    const missingInputs: MutationIntentMissingInput[] = [];
    const requestConflictKeys = new Map<string, readonly ConflictKey[]>();
    for (const requestPath of requestPaths) {
      if (!existsSync(requestPath)) {
        throw new CliError('ATM_FILE_NOT_FOUND', `Mutation request file not found: ${requestPath}`, { exitCode: 1 });
      }
      const request = JSON.parse(readFileSync(requestPath, 'utf8')) as MutationRequest;
      const classification = classifyExplicitMutationRequest(request);
      explicitInputs.push(...classification.explicitInputs);
      missingInputs.push(...classification.missingInputs);
      requests.push(request);
    }

    if (missingInputs.length > 0) {
      return makeResult({
        ok: false,
        command: 'broker',
        cwd: options.cwd,
        messages: [
          message(
            'warn',
            'ATM_BROKER_MUTATION_INTENT_MISSING_INPUTS',
            `Structured mutation intent is incomplete for ${missingInputs.length} input field(s); broker will not guess missing targets or operations.`,
            {
              missingInputCount: missingInputs.length,
              requestCount: requests.length
            }
          )
        ],
        evidence: {
          action: 'plan-batch',
          explicitInputs,
          missingInputs
        }
      });
    }

    const registry = defaultAdapterRegistry();

    // Load the current on-disk contents of each target file (when present) so the
    // planner parses the real document and CAS can compare base hashes.
    const fileContents: Record<string, string> = {};
    for (const request of requests) {
      if (fileContents[request.filePath] === undefined) {
        const absolute = path.resolve(options.cwd, request.filePath);
        fileContents[request.filePath] = existsSync(absolute) ? readFileSync(absolute, 'utf8') : '{}';
      }
    }

    const plan = planMutationBatch({ registry, requests, fileContents });

    for (const entry of plan.requestConflictKeys ?? []) {
      requestConflictKeys.set(entry.requestId, entry.conflictKeys);
    }

    const requestById = new Map(requests.map((request) => [request.requestId, request]));
    const batchedIds = new Set(plan.batches.flatMap((batch) => batch.requestIds));
    const mutationEvidence: BrokerMutationEvidenceEntry[] = [];
    const runEvidenceRecords: BrokerOperationRunRecord[] = [];
    let runEvidencePath: string | null = null;
    let runEvidencePathRelative: string | null = null;
    const casMismatches: string[] = [];
    let applied = false;

    if (options.apply) {
      const runId = randomUUID();
      const runEvidenceDir = resolveBrokerRunEvidenceDir(options);
      const runRecordPath = path.join(runEvidenceDir, `${runId}.json`);
      runEvidencePath = runRecordPath;
      runEvidencePathRelative = normalizeEvidencePath(options.cwd, runRecordPath);

      for (const batch of plan.batches) {
        const absolute = path.resolve(options.cwd, batch.filePath);
        const baseContents = fileContents[batch.filePath] ?? '{}';
        const file = { filePath: batch.filePath, content: baseContents };
        const adapter = resolveAdapter(registry, file);
        const baseHash = hashContent(baseContents);

        // CAS: re-read the file at apply time and verify it matches the base the
        // plan was built against. One-shot, no retry loop.
        const currentContents = existsSync(absolute) ? readFileSync(absolute, 'utf8') : '{}';
        const cas = computeCasResult({ filePath: batch.filePath, expectedBaseHash: baseHash, currentFileContents: currentContents });
        const batchRequests = batch.requestIds.map((id) => requestById.get(id)!).filter(Boolean);

        if (!cas.ok || adapter.id === 'fallback-file-lock') {
          if (!cas.ok) {
            casMismatches.push(batch.filePath);
          }
          for (const request of batchRequests) {
            const conflictKeys = requestConflictKeys.get(request.requestId) ?? [];
            mutationEvidence.push(buildMutationEvidence(adapter.id, request, baseHash, baseHash, batch.verdict, 'blocked', conflictKeys));
          }
          continue;
        }

        const parsed = adapter.parse(file);
        const merged = adapter.merge(batchRequests.map((request) => adapter.normalize(request)), parsed);
        const resultContents = adapter.serialize(merged);
        writeFileSync(absolute, resultContents, 'utf8');
        applied = true;
        const resultHash = hashContent(resultContents);
        for (const request of batchRequests) {
          const conflictKeys = requestConflictKeys.get(request.requestId) ?? [];
          mutationEvidence.push(buildMutationEvidence(adapter.id, request, baseHash, resultHash, batch.verdict, 'applied', conflictKeys));
        }
      }

      for (const id of [...plan.queued, ...plan.blocked]) {
        const request = requestById.get(id);
        if (!request) continue;
        const baseHash = hashContent(fileContents[request.filePath] ?? '{}');
        const conflictKeys = requestConflictKeys.get(id) ?? [];
        mutationEvidence.push(buildMutationEvidence('n/a', request, baseHash, baseHash, 'conflict', plan.blocked.includes(id) ? 'blocked' : 'queued', conflictKeys));
      }

      for (const entry of mutationEvidence) {
        const request = requestById.get(entry.requestId);
        if (!request) continue;
        runEvidenceRecords.push(buildTeamBrokerRunRecord({
          runId,
          planId: plan.planId,
          request,
          adapterChoice: entry.adapterId,
          laneDecision: entry.verdict,
          mergeVerdict: entry.mergeDecision,
          evidencePath: runEvidencePathRelative ?? 'unknown',
          appliedFiles: [entry.filePath],
          transactionIds: extractMutationRequestTransactionIds(request)
        }));
      }

      if (runEvidenceRecords.length > 0) {
        mkdirSync(runEvidenceDir, { recursive: true });
        const runEnvelope = buildTeamBrokerRunRecordEnvelope({
          runId,
          planId: plan.planId,
          records: runEvidenceRecords
        });
        writeFileSync(runEvidencePath, JSON.stringify(runEnvelope), 'utf8');
      }
    }

    const ok = plan.blocked.length === 0 && casMismatches.length === 0 && (!options.apply || applied || (plan.batches.length === 0));
    return makeResult({
      ok,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message(
          ok ? 'info' : 'warn',
          'ATM_BROKER_PLAN_BATCH',
          `Planned ${plan.batches.length} batch(es) over ${requests.length} request(s); queued=${plan.queued.length}, blocked=${plan.blocked.length}${options.apply ? `, applied=${applied}` : ''}.`,
          { planId: plan.planId, batchCount: plan.batches.length, casMismatchCount: casMismatches.length }
        )
      ],
      evidence: {
        action: 'plan-batch',
        explicitInputs,
        missingInputs,
        plan,
        applied: options.apply ? applied : false,
        casMismatches,
        mutationEvidence: options.apply ? mutationEvidence : [],
        runEvidencePath: runEvidencePathRelative,
        runRecords: options.apply ? runEvidenceRecords : [],
        unbatchedRequestIds: requests.map((request) => request.requestId).filter((id) => !batchedIds.has(id))
      }
    });
  }

  return null;
}
