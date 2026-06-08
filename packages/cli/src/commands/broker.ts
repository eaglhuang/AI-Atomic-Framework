import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message } from './shared.ts';
import {
  loadRegistry,
  saveRegistry,
  registerIntent,
  releaseTask,
  cleanupStale
} from '../../../core/src/broker/registry.ts';
import { calculateBrokerDecision } from '../../../core/src/broker/decision.ts';
import { composeBrokerProposals } from '../../../core/src/broker/compose.ts';
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
import type { PatchProposal, WriteIntent } from '../../../core/src/broker/types.ts';

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

    // 即使決策是 blocked，我們依然將其以 blocked 狀態註冊進去
    registry = registerIntent(registry, newIntent, decision.lane, options.ttlSeconds);
    saveRegistry(registryPath, registry);

    return makeResult({
      ok: decision.verdict === 'parallel-safe' || decision.verdict === 'needs-physical-split',
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message(
          decision.verdict === 'blocked-cid-conflict' || decision.verdict === 'blocked-shared-surface' ? 'error' : 'info',
          'ATM_BROKER_REGISTERED',
          `Write intent registered with verdict '${decision.verdict}' and lane '${decision.lane}'`,
          { decision }
        )
      ],
      evidence: {
        decision,
        registryPath: '.atm/runtime/write-broker.registry.json'
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
            ? `Broker compose blocked with verdict '${composeResult.mergePlan.verdict}'.`
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

  throw new CliError('ATM_CLI_USAGE', 'broker supports: register, decision, status, release, cleanup, proposal, compose', { exitCode: 2 });
}

interface ParsedBrokerOptions {
  readonly cwd: string;
  readonly action: 'register' | 'decision' | 'status' | 'release' | 'cleanup' | 'proposal' | 'compose' | null;
  readonly proposalAction: 'create' | 'list' | 'show' | 'validate' | null;
  readonly task: string | null;
  readonly intentFile: string | null;
  readonly ttlSeconds: number;
  readonly proposalFiles: readonly string[];
  readonly proposalIds: readonly string[];
  readonly proposalStorePath: string | null;
}

function parseBrokerArgs(argv: string[]): ParsedBrokerOptions {
  const state = {
    cwd: process.cwd(),
    action: null as ParsedBrokerOptions['action'],
    proposalAction: null as ParsedBrokerOptions['proposalAction'],
    task: null as string | null,
    intentFile: null as string | null,
    ttlSeconds: 1800,
    proposalFiles: [] as string[],
    proposalIds: [] as string[],
    proposalIdPositional: null as string | null,
    proposalStorePath: null as string | null
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
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `broker does not support option ${arg}`, { exitCode: 2 });
    }
    if (!state.action) {
      state.action = arg as ParsedBrokerOptions['action'];
    } else if (state.action === 'proposal' && !state.proposalAction) {
      state.proposalAction = arg as ParsedBrokerOptions['proposalAction'];
    } else if (state.action === 'proposal' && state.proposalAction && !state.proposalIdPositional) {
      state.proposalIdPositional = arg;
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
    task: state.task,
    intentFile: state.intentFile,
    ttlSeconds: state.ttlSeconds,
    proposalFiles: state.proposalFiles,
    proposalIds,
    proposalStorePath: state.proposalStorePath
  };
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
