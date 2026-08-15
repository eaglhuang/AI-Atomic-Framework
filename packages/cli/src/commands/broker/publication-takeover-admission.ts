import { CliError, makeResult, message } from '../shared.ts';
import type { RunnerSyncStewardQueueDocument } from '../../../../core/src/broker/runner-sync-steward-queue.ts';
import { authorizeRunnerPublicationTakeover } from '../framework-development/runner-publication-lifecycle.ts';
import type { RunnerBuildOutputTarget } from '../../../../core/src/broker/runner-build-output-inventory.ts';

export function assertPublicationTakeoverQueueAdmission(input: {
  readonly queue: RunnerSyncStewardQueueDocument;
  readonly taskId: string;
  readonly sealedSourceSha: string;
  readonly currentHeadSha: string;
}): void {
  const head = input.queue.groups[0];
  if (head) {
    if (head.sealedSourceSha !== input.sealedSourceSha || !head.waitingTasks.includes(input.taskId)) {
      throw new CliError('ATM_RUNNER_PUBLICATION_PENDING', 'Publication takeover requires the active queue-head task and its exact sealed source SHA.', { exitCode: 1 });
    }
    return;
  }
  if (input.sealedSourceSha !== input.currentHeadSha) {
    throw new CliError(
      'ATM_RUNNER_PUBLICATION_PENDING',
      'Publication takeover with an empty steward queue requires the sealed source SHA to match HEAD so generated-output authority can be bound before a new queue-head reservation.',
      { exitCode: 1 }
    );
  }
}

export function runRunnerSyncTakeoverPublication(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly sealedSourceSha: string;
  readonly currentHeadSha: string;
  readonly surface: string;
  readonly queue: RunnerSyncStewardQueueDocument;
  readonly currentTaskAllowedFiles: readonly string[];
}) {
  assertPublicationTakeoverQueueAdmission({
    queue: input.queue,
    taskId: input.taskId,
    sealedSourceSha: input.sealedSourceSha,
    currentHeadSha: input.currentHeadSha
  });
  const plan = authorizeRunnerPublicationTakeover({
    cwd: input.cwd,
    taskId: input.taskId,
    sealedSourceSha: input.sealedSourceSha,
    buildTarget: input.surface as RunnerBuildOutputTarget,
    currentTaskAllowedFiles: input.currentTaskAllowedFiles
  });
  return makeResult({
    ok: true,
    command: 'broker',
    cwd: input.cwd,
    messages: [message('info', 'ATM_BROKER_RUNNER_PUBLICATION_TAKEOVER_AUTHORIZED', `Authorized ${plan.entries.length} exact generated publication member(s) for the queue-head sealed build.`, { planDigest: plan.digest })],
    evidence: { plan, receiptPath: `.atm/history/evidence/${input.taskId}.runner-publication-takeover.json` }
  });
}
