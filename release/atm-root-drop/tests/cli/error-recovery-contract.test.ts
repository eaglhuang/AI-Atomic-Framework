import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type RegistryEntry = {
  readonly code: string;
  readonly category: string;
  readonly retryable: boolean;
  readonly requiresHumanApproval: boolean;
  readonly remediation: readonly string[];
  readonly relatedCommands: readonly string[];
  readonly sourceOwner: string;
};

const requiredCodes = [
  'ATM_RUNNER_SYNC_STALE_SHA',
  'ATM_TASK_ID_NORMALIZATION_MISMATCH',
  'ATM_ORPHAN_CLAIM_ADOPTABLE',
  'ATM_TICKET_ADOPT_REQUIRED',
  'ATM_TICKET_CANCEL_REQUIRED',
  'ATM_SIDE_EFFECT_RECONCILE_REQUIRED',
  'ATM_ATOMIC_WRITE_RETRY_EXHAUSTED',
  'ATM_RUNNER_RECEIPT_MISSING',
  'ATM_TASKS_PLAN_EMPTY',
  'ATM_TASK_IMPORT_REFERENCE_ONLY_ID_FRAGMENT'
] as const;

const registry = JSON.parse(readFileSync('docs/governance/error-code-registry.json', 'utf8')) as {
  readonly entries: readonly RegistryEntry[];
};

const entriesByCode = new Map(registry.entries.map((entry) => [entry.code, entry]));

function hasExecutableRecoveryCommand(entry: RegistryEntry): boolean {
  return [...entry.relatedCommands, ...entry.remediation].some((value) =>
    /\b(node|npm|git)\b/.test(value) && !/\b(TODO|TBD|when implemented|once implemented)\b/i.test(value)
  );
}

for (const code of requiredCodes) {
  const entry = entriesByCode.get(code);
  assert(entry, `${code} must have an exact registry entry`);
  assert.equal(typeof entry.retryable, 'boolean', `${code} retryable must be explicit`);
  assert.equal(typeof entry.requiresHumanApproval, 'boolean', `${code} approval requirement must be explicit`);
  assert(entry.category.trim().length > 0, `${code} must have a category`);
  assert(entry.sourceOwner.trim().length > 0, `${code} must have a source owner`);
  assert(hasExecutableRecoveryCommand(entry), `${code} must expose an executable recovery command`);
}

console.log('error-recovery-contract.test passed');
