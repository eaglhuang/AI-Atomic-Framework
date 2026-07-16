import assert from 'node:assert/strict';
import { createDeterministicTaskIntent } from '../route-resolution/intent.ts';
import { isFrameworkMaintenancePrompt } from '../route-predicates.ts';
import { isJournalingPrompt } from '../intent-normalizers.ts';

const journalingPrompts = [
  '請把 ATM-BUG-2026-07-16-999 記錄到 ATM bug backlog：runner-sync admission 需要 queue-head enforcement',
  '記一筆 ATM bug backlog，RFT broad scope 會吸入 foreign dirty files',
  '回寫 backlog item JSON，不要 claim RFT 任務'
];

for (const prompt of journalingPrompts) {
  const intent = createDeterministicTaskIntent(prompt);
  assert.equal(isJournalingPrompt(prompt), true, prompt);
  assert.equal(isFrameworkMaintenancePrompt(prompt), false, prompt);
  assert.equal(intent.taskScopeMentioned, false, prompt);
  assert.deepEqual(intent.mentionedTaskIds, [], prompt);
  assert.deepEqual(intent.taskRootHints, [], prompt);
  assert.equal(intent.queueRequested, false, prompt);
}

assert.equal(isFrameworkMaintenancePrompt('修 runner-sync admission 的 queue-head enforcement'), true);

const taskIntent = createDeterministicTaskIntent('請處理 TASK-RFT-0052');
assert.equal(taskIntent.taskScopeMentioned, true);
assert.ok(taskIntent.mentionedTaskIds.includes('TASK-RFT-0052'));

console.log('journaling-route.spec passed');
