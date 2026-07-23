// @ts-nocheck
import path from 'node:path';
import { CliError } from '../shared.ts';
import { parseBrokerArgs } from './parser.ts';
import { handleBrokerStewardQueues } from './steward-queues.ts';
import { handleBrokerRegistryActions } from './registry-actions.ts';
import { handleBrokerProposalActions } from './proposal-actions.ts';
import { handleBrokerStewardRuntimeActions } from './steward-runtime-actions.ts';
import { handleBrokerPlanBatch } from './plan-batch-action.ts';
import { handleBrokerWaveScheduler } from './wave-scheduler-actions.ts';
import { handleBrokerBatchExecute } from './batch-execute-actions.ts';
import { handleBrokerParallelAdmissionPolicy } from './policy-actions.ts';
import { handleBrokerReplayActions } from './replay-actions.ts';
import { runPostComposeSemanticValidation } from './post-compose-semantic-validation.ts';

export async function runBroker(argv: string[]) {
  const options = parseBrokerArgs(argv);
  const context = {
    registryPath: path.join(options.cwd, '.atm', 'runtime', 'write-broker.registry.json'),
    sharedQueuePath: path.join(options.cwd, '.atm', 'runtime', 'broker-shared-surface-queues.json'),
    sharedFreezePath: path.join(options.cwd, '.atm', 'runtime', 'broker-shared-surface-freezes.json'),
    runnerSyncQueuePath: path.join(options.cwd, '.atm', 'runtime', 'runner-sync-steward-queue.json'),
    projectionStewardPath: path.join(options.cwd, '.atm', 'runtime', 'generated-projection-steward.json'),
    waveSchedulerPath: path.join(options.cwd, '.atm', 'runtime', 'wave-broker-scheduler.json')
  };

  if (options.action === 'post-compose-semantic-validation') {
    return runPostComposeSemanticValidation({
      cwd: options.cwd,
      candidateFile: options.candidateFile
    });
  }

  const stewardQueueResult = handleBrokerStewardQueues(options, context);
  if (stewardQueueResult) return stewardQueueResult;
  const registryResult = handleBrokerRegistryActions(options, context);
  if (registryResult) return registryResult;
  const proposalResult = handleBrokerProposalActions(options);
  if (proposalResult) return proposalResult;
  const stewardRuntimeResult = handleBrokerStewardRuntimeActions(options, context);
  if (stewardRuntimeResult) return stewardRuntimeResult;
  const planBatchResult = handleBrokerPlanBatch(options);
  if (planBatchResult) return planBatchResult;
  const waveSchedulerResult = handleBrokerWaveScheduler(options, context);
  if (waveSchedulerResult) return waveSchedulerResult;
  const batchExecuteResult = handleBrokerBatchExecute(options, context);
  if (batchExecuteResult) return batchExecuteResult;
  const policyResult = handleBrokerParallelAdmissionPolicy(options, context);
  if (policyResult) return policyResult;
  const replayResult = await handleBrokerReplayActions(options);
  if (replayResult) return replayResult;

  throw new CliError('ATM_CLI_USAGE', 'broker supports: register, decision, status, release, acknowledge, cleanup, proposal, compose, steward, runtime, runner-sync, projection, plan-batch, schedule, batch, parallel-admission, replay, post-compose-semantic-validation', { exitCode: 2 });
}
