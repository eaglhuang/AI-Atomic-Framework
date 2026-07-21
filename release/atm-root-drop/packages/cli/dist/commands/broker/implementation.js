// @ts-nocheck
import path from 'node:path';
import { CliError } from '../shared.js';
import { parseBrokerArgs } from './parser.js';
import { handleBrokerStewardQueues } from './steward-queues.js';
import { handleBrokerRegistryActions } from './registry-actions.js';
import { handleBrokerProposalActions } from './proposal-actions.js';
import { handleBrokerStewardRuntimeActions } from './steward-runtime-actions.js';
import { handleBrokerPlanBatch } from './plan-batch-action.js';
import { handleBrokerWaveScheduler } from './wave-scheduler-actions.js';
import { handleBrokerBatchExecute } from './batch-execute-actions.js';
import { handleBrokerParallelAdmissionPolicy } from './policy-actions.js';
import { handleBrokerReplayActions } from './replay-actions.js';
export async function runBroker(argv) {
    const options = parseBrokerArgs(argv);
    const context = {
        registryPath: path.join(options.cwd, '.atm', 'runtime', 'write-broker.registry.json'),
        sharedQueuePath: path.join(options.cwd, '.atm', 'runtime', 'broker-shared-surface-queues.json'),
        sharedFreezePath: path.join(options.cwd, '.atm', 'runtime', 'broker-shared-surface-freezes.json'),
        runnerSyncQueuePath: path.join(options.cwd, '.atm', 'runtime', 'runner-sync-steward-queue.json'),
        projectionStewardPath: path.join(options.cwd, '.atm', 'runtime', 'generated-projection-steward.json'),
        waveSchedulerPath: path.join(options.cwd, '.atm', 'runtime', 'wave-broker-scheduler.json')
    };
    const stewardQueueResult = handleBrokerStewardQueues(options, context);
    if (stewardQueueResult)
        return stewardQueueResult;
    const registryResult = handleBrokerRegistryActions(options, context);
    if (registryResult)
        return registryResult;
    const proposalResult = handleBrokerProposalActions(options);
    if (proposalResult)
        return proposalResult;
    const stewardRuntimeResult = handleBrokerStewardRuntimeActions(options, context);
    if (stewardRuntimeResult)
        return stewardRuntimeResult;
    const planBatchResult = handleBrokerPlanBatch(options);
    if (planBatchResult)
        return planBatchResult;
    const waveSchedulerResult = handleBrokerWaveScheduler(options, context);
    if (waveSchedulerResult)
        return waveSchedulerResult;
    const batchExecuteResult = handleBrokerBatchExecute(options, context);
    if (batchExecuteResult)
        return batchExecuteResult;
    const policyResult = handleBrokerParallelAdmissionPolicy(options, context);
    if (policyResult)
        return policyResult;
    const replayResult = await handleBrokerReplayActions(options);
    if (replayResult)
        return replayResult;
    throw new CliError('ATM_CLI_USAGE', 'broker supports: register, decision, status, release, acknowledge, cleanup, proposal, compose, steward, runtime, runner-sync, projection, plan-batch, schedule, batch, parallel-admission, replay', { exitCode: 2 });
}
