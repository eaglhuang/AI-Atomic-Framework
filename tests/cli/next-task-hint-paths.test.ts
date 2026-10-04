import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDeterministicTaskIntent, inspectImportedTaskQueue } from '../../packages/cli/src/commands/next/route-resolution.ts';
import {
  extractTaskFamilyRootHintsFromPrompt,
  extractTaskIdReferencesFromPrompt,
  extractTaskRootHintsFromPrompt
} from '../../packages/cli/src/commands/next/route-resolution/matching.ts';

const newsletterPrompt = 'Add a real weekly newsletter issue in content/issue-001.json with a headline, summary, and two HTTPS source links, and an executable validator in scripts/check-newsletter.mjs that checks its structure and uniqueness. Validate, commit, record evidence, and close the bounded task.';
const contentPaths = [
  'content/issue-001.json',
  './content/ISSUE-001.json',
  'content/issue-001/002.json',
  'content/ISSUE-001/002/003.json',
  'issue-001.json',
  'content/ISSUE-001.json:12:4',
  'https://example.test/content/ISSUE-001.json#L12-L24',
  'content/TASK-NEWS-0001.json',
  'content/TASK-NEWS-0001/check.json',
  'content/ISSUE-FAMILY/data.json',
  'C:\\newsletter\\content\\ISSUE-001.json',
  'https://example.test/content/ISSUE-001.json'
];

for (const contentPath of contentPaths) {
  const prompt = `Update \`${contentPath}\` for this task`;
  assert.deepEqual(extractTaskIdReferencesFromPrompt(prompt), [], contentPath);
  assert.deepEqual(extractTaskRootHintsFromPrompt(prompt, []), [], contentPath);
  assert.deepEqual(extractTaskFamilyRootHintsFromPrompt(prompt), [], contentPath);
}

const taskReferences: readonly [string, readonly string[]][] = [
  ['Implement TASK-NEWS-0001', ['TASK-NEWS-0001']],
  ['Continue ATM-GOV-0263.', ['ATM-GOV-0263']],
  ['Close issue-001', ['ISSUE-001']],
  ['Implement TASK-NEWS-0001/0002,0003', ['TASK-NEWS-0001', 'TASK-NEWS-0002', 'TASK-NEWS-0003']],
  ['Implement TASK-NEWS-0001 / 0002, 0003', ['TASK-NEWS-0001', 'TASK-NEWS-0002', 'TASK-NEWS-0003']],
  ['Implement TASK-NEWS-0001/TASK-NEWS-0002', ['TASK-NEWS-0001', 'TASK-NEWS-0002']],
  ['Implement TASK-NEWS-0001.task.md', ['TASK-NEWS-0001']],
  ['Implement `docs/tasks/TASK-NEWS-0001.task.md`', ['TASK-NEWS-0001']],
  ['Implement docs/tasks/TASK-NEWS-0001.task.md:12:4', ['TASK-NEWS-0001']],
  ['Implement docs/tasks/TASK-NEWS-0001.task.md#L12-L24', ['TASK-NEWS-0001']],
  ['Implement https://example.test/tasks/ISSUE-001.md#L12', ['ISSUE-001']],
  ['Implement docs/tasks/TASK-NEWS-0001.md', ['TASK-NEWS-0001']],
  ['Implement ../planning/docs/tasks/TASK-NEWS-0001.task.md', ['TASK-NEWS-0001']],
  ['Implement C:\\planning\\tasks\\TASK-NEWS-0001.task.md', ['TASK-NEWS-0001']],
  ['Inspect .atm/history/tasks/TASK-NEWS-0001.json', ['TASK-NEWS-0001']],
  ['Implement TASK-NEWS-0001 with content/issue-001.json', ['TASK-NEWS-0001']]
];
for (const [prompt, expected] of taskReferences) {
  assert.deepEqual(extractTaskIdReferencesFromPrompt(prompt), expected, prompt);
}
assert.deepEqual(extractTaskRootHintsFromPrompt('Continue TASK-NEWS tasks', []), ['TASK-NEWS']);
assert.deepEqual(extractTaskFamilyRootHintsFromPrompt('Continue NEWS tasks'), ['TASK-NEWS']);
assert.deepEqual(extractTaskIdReferencesFromPrompt('Inspect ATM-BUG-2026-10-04-003'), []);

const intent = createDeterministicTaskIntent(newsletterPrompt);
assert.deepEqual(intent.mentionedTaskIds, [], 'real newsletter prompt must not invent a task ID');
assert.deepEqual(intent.taskRootHints, [], 'real newsletter prompt must not invent task roots');
assert.equal(intent.taskScopeMentioned, false);
const explicit = createDeterministicTaskIntent(newsletterPrompt, ['TASK-NEWS-0001']);
assert.deepEqual(explicit.explicitTaskIds, ['TASK-NEWS-0001']);
assert.deepEqual(explicit.mentionedTaskIds, []);
assert.equal(explicit.taskScopeMentioned, true);

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-next-content-path-'));
try {
  assert.equal(inspectImportedTaskQueue(cwd, intent).promptScope, null, 'new content work must not become task-scope-not-found');
  assert.equal(inspectImportedTaskQueue(cwd, explicit).promptScope?.status, 'not-found', 'an unknown explicit task must still fail closed');
  const taskId = 'TASK-NEWS-0001';
  const taskDir = path.join(cwd, '.atm', 'history', 'tasks');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(path.join(taskDir, `${taskId}.json`), JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Publish the newsletter issue',
    status: 'open',
    scopePaths: ['content/issue-001.json'],
    source: { planPath: `docs/tasks/${taskId}.task.md` }
  }));
  for (const prompt of [
    'Implement TASK-NEWS-0001 with content/issue-001.json',
    'Implement `docs/tasks/TASK-NEWS-0001.task.md`',
    'Implement docs/tasks/TASK-NEWS-0001.md'
  ]) {
    const queue = inspectImportedTaskQueue(cwd, createDeterministicTaskIntent(prompt));
    assert.equal(queue.promptScope?.status, 'ready', prompt);
    assert.equal(queue.selectedTask?.workItemId, taskId, prompt);
  }
  assert.equal(inspectImportedTaskQueue(cwd, explicit).selectedTask?.workItemId, taskId);
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
console.log('ok - content path task hints and explicit task references');
