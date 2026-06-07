import { readFileSync, existsSync } from 'node:fs';
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
import type { WriteIntent } from '../../../core/src/broker/types.ts';

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

  throw new CliError('ATM_CLI_USAGE', 'broker supports: register, decision, status, release, cleanup', { exitCode: 2 });
}

interface ParsedBrokerOptions {
  readonly cwd: string;
  readonly action: 'register' | 'decision' | 'status' | 'release' | 'cleanup' | null;
  readonly task: string | null;
  readonly intentFile: string | null;
  readonly ttlSeconds: number;
}

function parseBrokerArgs(argv: string[]): ParsedBrokerOptions {
  const state = {
    cwd: process.cwd(),
    action: null as ParsedBrokerOptions['action'],
    task: null as string | null,
    intentFile: null as string | null,
    ttlSeconds: 1800
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
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `broker does not support option ${arg}`, { exitCode: 2 });
    }
    if (state.action) {
      throw new CliError('ATM_CLI_USAGE', 'broker accepts only one action.', { exitCode: 2 });
    }
    state.action = arg as ParsedBrokerOptions['action'];
  }

  return {
    cwd: path.resolve(state.cwd),
    action: state.action,
    task: state.task,
    intentFile: state.intentFile,
    ttlSeconds: state.ttlSeconds
  };
}

function requireValue(argv: string[], optionIndex: number, optionName: string) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `broker requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}
