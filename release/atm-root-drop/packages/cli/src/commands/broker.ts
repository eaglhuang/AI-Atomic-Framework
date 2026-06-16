import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CliError, makeResult, message } from './shared.ts';
import {
  loadRegistry,
  saveRegistry,
  registerIntent,
  renewIntentLease,
  releaseTask,
  cleanupStale
} from '../../../core/src/broker/registry.ts';
import { calculateBrokerDecision } from '../../../core/src/broker/decision.ts';
import { composeBrokerProposals } from '../../../core/src/broker/compose.ts';
import {
  applyStewardPlan,
  executeBrokerScopedWrite,
  planStewardApply
} from '../../../core/src/broker/steward.ts';
import {
  buildTeamBrokerRuntimeActivationHandshake,
  buildTeamBrokerRunRecord,
  buildTeamBrokerRunRecordEnvelope
} from '../../../core/src/broker/team-lane.ts';
import {
  defaultBrokerProposalStoreRelativePath,
  findBrokerProposal,
  listBrokerProposalSummaries,
  loadBrokerProposalStore,
  readBrokerProposalFile,
  saveBrokerProposalStore,
  upsertBrokerProposalStore,
  validateBrokerProposal
} from '../../../core/src/broker/proposal.ts';
import { defaultAdapterRegistry, resolveAdapter } from '../../../core/src/broker/adapters/registry.ts';
import { planMutationBatch } from '../../../core/src/broker/adapters/batch-planner.ts';
import { computeCasResult, hashContent } from '../../../core/src/broker/adapters/cas.ts';
import type { BrokerMutationEvidenceEntry, MergePlan, MutationRequest, PatchProposal, WriteIntent, ConflictKey, BrokerOperationRunRecord } from '../../../core/src/broker/types.ts';

const defaultFallbackBrokerRunEvidenceRelativeDir = path.join(
  '.atm',
  'runtime',
  'broker-collision-evidence',
  'runs'
);

export async function runBroker(argv: string[]) {
  const options = parseBrokerArgs(argv);
  const registryPath = path.join(options.cwd, '.atm', 'runtime', 'write-broker.registry.json');

  if (options.action === 'register') {
    if (!options.task) {
      throw new CliError('ATM_CLI_USAGE', 'broker register requires --task <task-id>.', { exitCode: 2 });
    }
    if (!options.intentFile) {
      throw new CliError('ATM_CLI_USAGE', 'broker register requires --intent-file <path>.', { exitCode: 2 });
    }
    const intentFilePath = path.resolve(options.intentFile);
    if (!existsSync(intentFilePath)) {
      throw new CliError('ATM_FILE_NOT_FOUND', `Intent file not found: ${options.intentFile}`, { exitCode: 1 });
    }

    const newIntent = JSON.parse(readFileSync(intentFilePath, 'utf8')) as WriteIntent;
    let registry = loadRegistry(registryPath);
    const decision = calculateBrokerDecision(newIntent, registry);
    const conflictMatrix = decision.conflictMatrix;
    const isBrokerSafe = decision.verdict !== 'blocked-cid-conflict'
      && decision.verdict !== 'blocked-shared-surface'
      && decision.verdict !== 'blocked-active-lease';

    // 即使決策是 blocked，我們依然將其以 blocked 狀態註冊進去
    registry = registerIntent(registry, newIntent, decision.lane, options.ttlSeconds);
    saveRegistry(registryPath, registry);

    return makeResult({
      ok: isBrokerSafe,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message(
          isBrokerSafe ? 'info' : 'error',
          'ATM_BROKER_REGISTERED',
          `Write intent registered with verdict '${decision.verdict}' and lane '${decision.lane}'. Arbitration matrix verdict: '${conflictMatrix?.arbitrationVerdict ?? 'n/a'}'. Broker verdicts override Coordinator decisions inside broker-governed conflict domains; Coordinator remains local outside them.`,
          { decision }
        )
      ],
      evidence: {
        decision,
        registryPath: '.atm/runtime/write-broker.registry.json'
      }
    });
  }

  if (options.action === 'heartbeat') {
    if (!options.task) {
      throw new CliError('ATM_CLI_USAGE', 'broker heartbeat requires --task <task-id>.', { exitCode: 2 });
    }
    if (!options.actorId) {
      throw new CliError('ATM_CLI_USAGE', 'broker heartbeat requires --actor <actor-id>.', { exitCode: 2 });
    }
    let registry = loadRegistry(registryPath);
    registry = renewIntentLease(registry, options.task, options.actorId, options.ttlSeconds);
    saveRegistry(registryPath, registry);

    return makeResult({
      ok: true,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_BROKER_HEARTBEAT_RENEWED', `Renewed write-intent lease for task ${options.task}.`)
      ],
      evidence: {
        registryPath: '.atm/runtime/write-broker.registry.json',
        renewedTask: options.task,
        actorId: options.actorId
      }
    });
  }

  if (options.action === 'decision') {
    if (!options.intentFile) {
      throw new CliError('ATM_CLI_USAGE', 'broker decision requires --intent-file <path>.', { exitCode: 2 });
    }
    const intentFilePath = path.resolve(options.intentFile);
    if (!existsSync(intentFilePath)) {
      throw new CliError('ATM_FILE_NOT_FOUND', `Intent file not found: ${options.intentFile}`, { exitCode: 1 });
    }

    const newIntent = JSON.parse(readFileSync(intentFilePath, 'utf8')) as WriteIntent;
    const registry = loadRegistry(registryPath);
    const decision = calculateBrokerDecision(newIntent, registry);

    return makeResult({
      ok: true,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_BROKER_DECISION', `Calculated broker decision: verdict '${decision.verdict}', lane '${decision.lane}'`)
      ],
      evidence: {
        decision
      }
    });
  }

  if (options.action === 'status') {
    const registry = loadRegistry(registryPath);
    return makeResult({
      ok: true,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_BROKER_STATUS', `Active write intents in registry: ${registry.activeIntents.length}`)
      ],
      evidence: {
        registryPath: '.atm/runtime/write-broker.registry.json',
        activeIntents: registry.activeIntents
      }
    });
  }

  if (options.action === 'release') {
    if (!options.task) {
      throw new CliError('ATM_CLI_USAGE', 'broker release requires --task <task-id>.', { exitCode: 2 });
    }
    let registry = loadRegistry(registryPath);
    registry = releaseTask(registry, options.task);
    saveRegistry(registryPath, registry);

    return makeResult({
      ok: true,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_BROKER_RELEASED', `Released all write intents for task ${options.task}`)
      ],
      evidence: {
        registryPath: '.atm/runtime/write-broker.registry.json',
        releasedTask: options.task
      }
    });
  }

  if (options.action === 'cleanup') {
    let registry = loadRegistry(registryPath);
    registry = cleanupStale(registry);
    saveRegistry(registryPath, registry);

    return makeResult({
      ok: true,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message('info', 'ATM_BROKER_CLEANED', 'Cleaned up stale write intents from registry')
      ],
      evidence: {
        registryPath: '.atm/runtime/write-broker.registry.json'
      }
    });
  }

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
    const requestConflictKeys = new Map<string, readonly ConflictKey[]>();
    for (const requestPath of requestPaths) {
      if (!existsSync(requestPath)) {
        throw new CliError('ATM_FILE_NOT_FOUND', `Mutation request file not found: ${requestPath}`, { exitCode: 1 });
      }
      const request = JSON.parse(readFileSync(requestPath, 'utf8')) as MutationRequest;
      requests.push(request);
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
          appliedFiles: [entry.filePath]
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

  throw new CliError('ATM_CLI_USAGE', 'broker supports: register, decision, status, release, cleanup, proposal, compose, steward, runtime, plan-batch', { exitCode: 2 });
}

function buildMutationEvidence(
  adapterId: string,
  request: MutationRequest,
  baseHash: string,
  resultHash: string,
  mergeDecision: BrokerMutationEvidenceEntry['mergeDecision'],
  verdict: BrokerMutationEvidenceEntry['verdict'],
  conflictKeys: readonly ConflictKey[]
): BrokerMutationEvidenceEntry {
  return {
    requestId: request.requestId,
    actorId: request.actorId,
    adapterId,
    filePath: request.filePath,
    baseHash,
    resultHash,
    conflictKeys,
    mergeDecision,
    verdict
  };
}

interface ParsedBrokerOptions {
  readonly cwd: string;
  readonly action: 'register' | 'heartbeat' | 'decision' | 'status' | 'release' | 'cleanup' | 'proposal' | 'compose' | 'steward' | 'runtime' | 'plan-batch' | null;
  readonly proposalAction: 'create' | 'list' | 'show' | 'validate' | null;
  readonly stewardAction: 'plan' | 'apply' | null;
  readonly runtimeAction: 'activate' | null;
  readonly task: string | null;
  readonly actorId: string | null;
  readonly intentFile: string | null;
  readonly ttlSeconds: number;
  readonly proposalFiles: readonly string[];
  readonly proposalIds: readonly string[];
  readonly proposalStorePath: string | null;
  readonly mergePlanFile: string | null;
  readonly scopeFiles: readonly string[];
  readonly stewardId: string | null;
  readonly evidenceOutPath: string | null;
  readonly requestFiles: readonly string[];
  readonly requestsDir: string | null;
  readonly runEvidenceDir: string | null;
  readonly apply: boolean;
}

function parseBrokerArgs(argv: string[]): ParsedBrokerOptions {
  const state = {
    cwd: process.cwd(),
    action: null as ParsedBrokerOptions['action'],
    proposalAction: null as ParsedBrokerOptions['proposalAction'],
    stewardAction: null as ParsedBrokerOptions['stewardAction'],
    runtimeAction: null as ParsedBrokerOptions['runtimeAction'],
    task: null as string | null,
    actorId: null as string | null,
    intentFile: null as string | null,
    ttlSeconds: 1800,
    proposalFiles: [] as string[],
    proposalIds: [] as string[],
    proposalIdPositional: null as string | null,
    proposalStorePath: null as string | null,
    mergePlanFile: null as string | null,
    scopeFiles: [] as string[],
    stewardId: null as string | null,
    evidenceOutPath: null as string | null,
    requestFiles: [] as string[],
    requestsDir: null as string | null,
    runEvidenceDir: null as string | null,
    apply: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      state.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--task') {
      state.task = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      state.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--intent-file') {
      state.intentFile = requireValue(argv, index, '--intent-file');
      index += 1;
      continue;
    }
    if (arg === '--ttl-seconds') {
      const val = requireValue(argv, index, '--ttl-seconds');
      state.ttlSeconds = parseInt(val, 10);
      index += 1;
      continue;
    }
    if (arg === '--proposal-file') {
      state.proposalFiles.push(requireValue(argv, index, '--proposal-file'));
      index += 1;
      continue;
    }
    if (arg === '--proposal-id') {
      state.proposalIds.push(requireValue(argv, index, '--proposal-id'));
      index += 1;
      continue;
    }
    if (arg === '--store') {
      state.proposalStorePath = requireValue(argv, index, '--store');
      index += 1;
      continue;
    }
    if (arg === '--merge-plan-file') {
      state.mergePlanFile = requireValue(argv, index, '--merge-plan-file');
      index += 1;
      continue;
    }
    if (arg === '--scope-file') {
      state.scopeFiles.push(requireValue(argv, index, '--scope-file'));
      index += 1;
      continue;
    }
    if (arg === '--steward-id') {
      state.stewardId = requireValue(argv, index, '--steward-id');
      index += 1;
      continue;
    }
    if (arg === '--evidence-out') {
      state.evidenceOutPath = requireValue(argv, index, '--evidence-out');
      index += 1;
      continue;
    }
    if (arg === '--run-evidence-dir') {
      state.runEvidenceDir = requireValue(argv, index, '--run-evidence-dir');
      index += 1;
      continue;
    }
    if (arg === '--request-file') {
      state.requestFiles.push(requireValue(argv, index, '--request-file'));
      index += 1;
      continue;
    }
    if (arg === '--requests-dir') {
      state.requestsDir = requireValue(argv, index, '--requests-dir');
      index += 1;
      continue;
    }
    if (arg === '--apply') {
      state.apply = true;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `broker does not support option ${arg}`, { exitCode: 2 });
    }
    if (!state.action) {
      state.action = arg as ParsedBrokerOptions['action'];
    } else if (state.action === 'proposal' && !state.proposalAction) {
      state.proposalAction = arg as ParsedBrokerOptions['proposalAction'];
    } else if (state.action === 'proposal' && state.proposalAction && !state.proposalIdPositional) {
      state.proposalIdPositional = arg;
    } else if (state.action === 'steward' && !state.stewardAction) {
      state.stewardAction = arg as ParsedBrokerOptions['stewardAction'];
    } else if (state.action === 'runtime' && !state.runtimeAction) {
      state.runtimeAction = arg as ParsedBrokerOptions['runtimeAction'];
    } else {
      throw new CliError('ATM_CLI_USAGE', 'broker accepts only one action (and optional proposal subaction).', { exitCode: 2 });
    }
  }

  const proposalIds = state.proposalIds.length > 0
    ? state.proposalIds
    : state.proposalIdPositional
      ? [state.proposalIdPositional]
      : [];

  return {
    cwd: path.resolve(state.cwd),
    action: state.action,
    proposalAction: state.proposalAction,
    stewardAction: state.stewardAction,
    runtimeAction: state.runtimeAction,
    task: state.task,
    actorId: state.actorId,
    intentFile: state.intentFile,
    ttlSeconds: state.ttlSeconds,
    proposalFiles: state.proposalFiles,
    proposalIds,
    proposalStorePath: state.proposalStorePath,
    mergePlanFile: state.mergePlanFile,
    scopeFiles: state.scopeFiles,
    stewardId: state.stewardId,
    evidenceOutPath: state.evidenceOutPath,
    requestFiles: state.requestFiles,
    requestsDir: state.requestsDir,
    runEvidenceDir: state.runEvidenceDir,
    apply: state.apply
  };
}

function readConfiguredBrokerRunEvidenceDir(cwd: string): string | null {
  try {
    const configPath = path.join(cwd, '.atm', 'config.json');
    if (!existsSync(configPath)) {
      return null;
    }
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const broker = config && typeof config === 'object' ? (config as any).broker : null;
    const dir = broker && typeof broker === 'object' ? broker.runEvidenceDir : null;
    return typeof dir === 'string' && dir.trim() ? dir.trim() : null;
  } catch {
    return null;
  }
}

function resolveBrokerRunEvidenceDir(options: ParsedBrokerOptions): string {
  const configuredDir = options.runEvidenceDir
    ?? process.env.ATM_BROKER_RUN_EVIDENCE_DIR
    ?? readConfiguredBrokerRunEvidenceDir(options.cwd)
    ?? null;
  if (configuredDir) {
    return path.resolve(options.cwd, configuredDir);
  }
  return path.resolve(options.cwd, defaultFallbackBrokerRunEvidenceRelativeDir);
}

function normalizeEvidencePath(cwd: string, filePath: string): string {
  const absolute = path.resolve(filePath);
  const relative = path.relative(cwd, absolute);
  return relative.startsWith('..') || path.isAbsolute(relative)
    ? absolute.replace(/\\/g, '/')
    : relative.replace(/\\/g, '/');
}

function loadComposeProposals(options: ParsedBrokerOptions): PatchProposal[] {
  const proposals: PatchProposal[] = [];
  const seen = new Set<string>();

  for (const proposalFile of options.proposalFiles) {
    const proposal = readBrokerProposalFile(path.resolve(options.cwd, proposalFile));
    if (!seen.has(proposal.proposalId)) {
      seen.add(proposal.proposalId);
      proposals.push(proposal);
    }
  }

  if (options.proposalStorePath || options.proposalIds.length > 0) {
    const storePath = path.join(options.cwd, options.proposalStorePath ?? defaultBrokerProposalStoreRelativePath);
    const store = loadBrokerProposalStore(storePath);
    const ids = options.proposalIds.length > 0
      ? [...options.proposalIds].sort((left, right) => left.localeCompare(right))
      : [...store.proposals].map((proposal) => proposal.proposalId).sort((left, right) => left.localeCompare(right));

    for (const proposalId of ids) {
      const proposal = findBrokerProposal(store, proposalId);
      if (!proposal) {
        throw new CliError('ATM_BROKER_PROPOSAL_NOT_FOUND', `Broker proposal not found: ${proposalId}`, {
          exitCode: 2,
          details: { proposalId, storePath: relativeStorePath(options.cwd, storePath) }
        });
      }
      if (!seen.has(proposal.proposalId)) {
        seen.add(proposal.proposalId);
        proposals.push(proposal);
      }
    }
  }

  if (proposals.length === 0) {
    throw new CliError('ATM_CLI_USAGE', 'broker compose requires --proposal-file <path> and/or --store <path> with optional --proposal-id <id>.', { exitCode: 2 });
  }

  return proposals;
}

function requireValue(argv: string[], optionIndex: number, optionName: string) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `broker requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}

function relativeStorePath(cwd: string, storePath: string): string {
  return path.relative(cwd, storePath) || path.basename(storePath);
}
