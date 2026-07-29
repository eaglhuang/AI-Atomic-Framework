import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ATM_ERROR_CODE_REGISTRY } from '../../packages/core/src/error-code-registry.generated.ts';

const required = [
  'ATM_WRITE_SCOPE_AMENDMENT_REQUIRED',
  'ATM_WRITE_SCOPE_UNATTACHED_WIP',
  'ATM_WRITE_TICKET_SCOPE_VIOLATION',
  'ATM_WRITE_TICKET_MISSING',
  'ATM_WRITE_TICKET_STALE'
];

const registryText = readFileSync('docs/governance/error-code-registry.json', 'utf8');
const docsText = readFileSync('docs/ERROR_CODES.md', 'utf8');
const registry = JSON.parse(registryText) as { entries: Array<Record<string, unknown>> };

for (const code of required) {
  const entry = registry.entries.find((candidate) => candidate.code === code);
  assert.ok(entry, `${code} must be registered exactly`);
  assert.equal(entry.category, 'write-ticket');
  assert.equal(typeof entry.retryable, 'boolean');
  assert.equal(typeof entry.requiresHumanApproval, 'boolean');
  assert.equal(typeof entry.sourceOwner, 'string');
  assert.ok(Array.isArray(entry.relatedCommands));
  assert.match(registryText, new RegExp(code));
  assert.match(docsText, new RegExp(code));
  assert.ok(ATM_ERROR_CODE_REGISTRY.entries.some((candidate) => candidate.code === code), `${code} must be projected into generated registry`);
}

console.log('[write-ticket-error-code-registry.test] ok');
