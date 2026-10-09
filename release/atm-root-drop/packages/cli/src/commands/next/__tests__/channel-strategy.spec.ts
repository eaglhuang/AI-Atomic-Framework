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

const npmRecovery = decideRuntimeNextAction({ config: null }, null, emptyQueue, 'npm exec -- atm');
assert.equal(npmRecovery.command, 'npm exec -- atm bootstrap --cwd . --task "Bootstrap ATM in this repository"');
assert.ok(npmRecovery.allowedCommands.includes('npm exec -- atm orient --cwd . --json'));
const npmOnboardingRecovery = decideRuntimeNextAction({ config: true }, 'onboarding-lifecycle', emptyQueue, 'npm exec -- atm');
assert.equal(npmOnboardingRecovery.command, 'npm exec -- atm atm-chart render --cwd . --json');
const npmReady = decideRuntimeNextAction({ config: true, currentTaskId: 'TASK-1', lastEvidenceAt: 'now', lastHandoffAt: 'now' }, null, emptyQueue, 'npm exec -- atm', 'npm-package');
assert.equal(npmReady.command, 'npm test --if-present');
const explicitNpmReady = decideRuntimeNextAction({ config: true, currentTaskId: 'TASK-1', lastEvidenceAt: 'now', lastHandoffAt: 'now' }, null, emptyQueue,
  "node '/shared runtime/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs'", 'npm-package');
assert.equal(explicitNpmReady.command, 'npm test --if-present');
assert.equal(decideRuntimeNextAction({ config: true, currentTaskId: 'TASK-1', lastEvidenceAt: 'now', lastHandoffAt: 'now' }, null, emptyQueue,
  'npm exec -- atm', 'frozen').command, 'npm test', 'runner kind, not display text, owns ready semantics');

const inputProbe = { probe: 'value', nested: { count: 1 } };
const readyRuntime = { config: true, currentTaskId: 'TASK-1', lastEvidenceAt: 'now', lastHandoffAt: 'now' };
assert.equal(decideRuntimeNextAction(readyRuntime, null, emptyQueue,
  'node atm.mjs', 'frozen', 'adopter').command, 'npm test --if-present',
  'a create-atm shim must use adopter validation despite its frozen runner mode');
assert.equal(decideRuntimeNextAction(readyRuntime, null, emptyQueue,
  'node atm.mjs', 'frozen', 'adopter', false).command, 'node atm.mjs doctor --json',
  'a non-npm adopter must not receive an npm command');
assert.equal(decideRuntimeNextAction(readyRuntime, 'onboarding-policy', emptyQueue,
  'node atm.mjs', 'frozen', 'adopter').command, 'node atm.mjs doctor --json',
  'adopter recovery must not assume the framework validate:full script exists');
assert.equal(decideRuntimeNextAction(readyRuntime, 'onboarding-policy', emptyQueue,
  'node atm.mjs', 'frozen', 'framework').command, 'npm run validate:full');
assert.equal(channelStrategyPreservesInput(inputProbe, () => selectQuickfixChannel()), true);

console.log('[channel-strategy.spec] ok');
