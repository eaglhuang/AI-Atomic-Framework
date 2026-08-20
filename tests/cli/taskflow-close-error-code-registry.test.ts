import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ATM_ERROR_CODE_REGISTRY } from '../../packages/core/src/error-code-registry.generated.ts';

const required = [
  'ATM_TASKFLOW_PRECLOSE_BLOCKED',
  'ATM_TASKFLOW_CLOSE_WRITE_NOT_READY',
  'ATM_TASKFLOW_CLOSE_OWNED_DIRTY_PENDING'
];

const registryText = readFileSync('docs/governance/error-code-registry.json', 'utf8');
const docsText = readFileSync('docs/ERROR_CODES.md', 'utf8');
const registry = JSON.parse(registryText) as { entries: Array<Record<string, unknown>> };

for (const code of required) {
  const entry = registry.entries.find((candidate) => candidate.code === code);
  assert.ok(entry, `${code} must be registered exactly`);
  assert.equal(entry.category, 'taskflow');
  assert.equal(entry.retryable, true);
  assert.equal(entry.requiresHumanApproval, false);
  assert.equal(entry.registryOwner, 'TASK-ERR-0015');
  assert.equal(entry.sourceOwner, 'packages/cli/src/commands/taskflow/implementation.ts');
  assert.ok(Array.isArray(entry.relatedCommands) && entry.relatedCommands.length > 0);
  assert.match(docsText, new RegExp(code));
  assert.ok(
    ATM_ERROR_CODE_REGISTRY.entries.some((candidate) => candidate.code === code),
    `${code} must be projected into the generated registry`
  );
}

console.log('[taskflow-close-error-code-registry.test] ok');
