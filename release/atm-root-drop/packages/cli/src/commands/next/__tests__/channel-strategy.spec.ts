import assert from 'node:assert/strict';
import {
  channelStrategyPreservesInput,
  decideRuntimeNextAction,
  selectBatchChannel,
  selectNormalTaskRouteChannel,
  selectPostClaimChannel,
  selectQuickfixChannel,
  selectUnknownRuntimeChannel
} from '../channel-strategy.ts';
import type { ImportedTaskQueue } from '../route-predicates.ts';

const emptyQueue = {
  tasks: [],
  selectedTask: null,
  claimableTask: null,
  promptScope: null,
  taskStorePath: '',
  openTaskCount: 0
} satisfies ImportedTaskQueue;

assert.equal(selectQuickfixChannel().channel, 'fast');
assert.equal(selectQuickfixChannel().recommendedChannel, 'fast');
assert.equal(selectQuickfixChannel().riskLevel, 'low');

assert.equal(selectBatchChannel('batch queue head active').channel, 'batch');
assert.equal(selectBatchChannel('batch queue head active').riskLevel, 'high');

assert.equal(selectNormalTaskRouteChannel('prompt resolves to one task').channel, 'task-route-ready');
assert.equal(selectNormalTaskRouteChannel('prompt resolves to one task').recommendedChannel, 'normal');

assert.equal(selectPostClaimChannel(true).channel, 'batch');
assert.equal(selectPostClaimChannel(false).channel, 'normal');

const unknown = selectUnknownRuntimeChannel();
assert.equal(unknown.stableCode, 'ATM_NEXT_CHANNEL_UNKNOWN_FALLBACK');
assert.equal(unknown.channel, 'normal');

const runtimeAction = decideRuntimeNextAction({ config: null }, null, emptyQueue);
assert.equal(runtimeAction.status, 'needs-bootstrap');
assert.equal(runtimeAction.command.includes('bootstrap'), true);

const inputProbe = { probe: 'value', nested: { count: 1 } };
assert.equal(channelStrategyPreservesInput(inputProbe, () => selectQuickfixChannel()), true);

console.log('[channel-strategy.spec] ok');
