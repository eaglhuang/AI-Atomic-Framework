import assert from 'node:assert/strict';

import {
  TASK_ACTION_LEXICON,
  createDeterministicTaskIntent,
  detectRequestedTaskAction,
  matchesTaskContinuationVerb
} from '../../packages/cli/src/commands/next/route-resolution/intent.ts';
import {
  attachSharedWriteActorAuthority,
  buildCommandManifest,
  buildOrderedCommandStep,
  inspectCommandExecutability
} from '../../packages/cli/src/commands/shared/command-manifest.ts';

// Multilingual closeout/continuation verbs route through the data lexicon, not a
// per-task lexical branch. English + Traditional Chinese both resolve.
assert.equal(detectRequestedTaskAction('please close ATM-GOV-0263'), 'close');
assert.equal(detectRequestedTaskAction('關閉 ATM-GOV-0263'), 'close');
assert.equal(detectRequestedTaskAction('收口 ATM-GOV-0263'), 'close');
assert.equal(detectRequestedTaskAction('redo the card'), 'redo');
assert.equal(detectRequestedTaskAction('重做這張卡'), 'redo');
assert.equal(detectRequestedTaskAction('no action verb here'), null);
assert.ok(TASK_ACTION_LEXICON.length >= 5);

// Continuation verbs are recognized across languages.
for (const prompt of ['continue ATM-GOV-0263', '繼續 ATM-GOV-0263', '接著做', 'proceed', 'finish it', '收口']) {
  assert.equal(matchesTaskContinuationVerb(prompt), true, `${prompt} must match a continuation verb`);
}
assert.equal(matchesTaskContinuationVerb('start something new'), false);

// An explicit task id plus a continuation verb enters task-scoped routing.
const intent = createDeterministicTaskIntent('繼續 ATM-GOV-0263', ['ATM-GOV-0263']);
assert.ok(intent.mentionedTaskIds.includes('ATM-GOV-0263'));
assert.equal(intent.taskScopeMentioned, true);
assert.ok(intent.userPrompt !== null && matchesTaskContinuationVerb(intent.userPrompt));

// Same-actor adopted lane and explicit actor authority survive into a
// continuation manifest; ambient identity cannot silently swap the worker.
const manifest = buildCommandManifest({
  argv: ['atm.mjs', 'taskflow', 'close', '--task', 'ATM-GOV-0263', '--json']
});
const step = attachSharedWriteActorAuthority(buildOrderedCommandStep('close', manifest), {
  actorId: 'claude-002-plan31-captain',
  resolutionSource: 'steward-input',
  laneSessionId: 'lane-abc',
  copyableCommand: 'node atm.mjs taskflow close --task ATM-GOV-0263 --actor claude-002-plan31-captain --json'
});
assert.equal(step.actorAuthority?.actorId, 'claude-002-plan31-captain');
assert.equal(step.actorAuthority?.laneSessionId, 'lane-abc');
assert.equal(step.manifest.shell, false);

// Bounded replay: a two-step continuation emits only executable manifests, so a
// captain can follow the guidance with zero usage-error command repair.
const replaySteps = [
  'node atm.mjs broker status --json',
  'node atm.mjs tasks status --task ATM-GOV-0263 --json',
  'node atm.mjs taskflow close --task ATM-GOV-0263 --actor claude-002-plan31-captain --json'
];
const usageErrors = replaySteps.filter((command) => !inspectCommandExecutability(command).ok);
assert.deepEqual(usageErrors, [], `every replayed command must be executable: ${usageErrors.join(', ')}`);

console.log('autonomous-task-continuation.test passed');
