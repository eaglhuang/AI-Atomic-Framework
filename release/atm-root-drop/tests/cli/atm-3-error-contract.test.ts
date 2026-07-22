import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type CommandManifest = {
  readonly schemaId: string;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly shell?: boolean;
};

type RegistryEntry = {
  readonly code: string;
  readonly category: string;
  readonly shortDescription: string;
  readonly commonCauses: readonly string[];
  readonly remediation: readonly string[];
  readonly retryable: boolean;
  readonly requiresHumanApproval: boolean;
  readonly relatedCommands: readonly string[];
  readonly sourceOwner: string;
  readonly statusCommand?: string;
  readonly recoveryManifests?: readonly CommandManifest[];
};

const requiredCodes = [
  'ATM_BROKER_STATE_DIVERGENCE',
  'ATM_EVIDENCE_SEAL_REQUIRED',
  'ATM_BROKER_TICKET_STALE_GENERATION',
  'ATM_BROKER_AUTHORIZATION_DIMENSION_MISMATCH',
  'ATM_SCOPE_AMENDMENT_REQUIRED',
  'ATM_BROKER_REARBITRATION_REQUIRED',
  'ATM_RUNNER_SYNC_ORPHAN',
  'ATM_PROTECTED_GOVERNANCE_STATE_DESTRUCTIVE_WRITE'
] as const;

const registry = JSON.parse(readFileSync('docs/governance/error-code-registry.json', 'utf8')) as {
  readonly entries: readonly RegistryEntry[];
};

const entriesByCode = new Map(registry.entries.map((entry) => [entry.code, entry]));

function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  assert.equal(typeof value, 'string', message);
  const text = value as string;
  assert(text.trim().length > 0, message);
}

for (const code of requiredCodes) {
  const entry = entriesByCode.get(code);
  assert(entry, `${code} must have an exact registry entry`);

  assertNonEmptyString(entry.category, `${code} must have a category`);
  assertNonEmptyString(entry.shortDescription, `${code} must have a description`);
  assertNonEmptyString(entry.sourceOwner, `${code} must have a source owner`);
  assertNonEmptyString(entry.statusCommand, `${code} must expose a status command`);
  assert.equal(typeof entry.retryable, 'boolean', `${code} retryable must be explicit`);
  assert.equal(typeof entry.requiresHumanApproval, 'boolean', `${code} human approval must be explicit`);
  assert(entry.commonCauses.length > 0, `${code} must describe trigger/common causes`);
  assert(entry.remediation.length > 0, `${code} must describe recovery`);
  assert(entry.relatedCommands.includes(entry.statusCommand), `${code} status command must be copyable from relatedCommands`);

  const manifests = entry.recoveryManifests ?? [];
  assert(manifests.length > 0, `${code} must expose at least one recovery manifest`);
  for (const manifest of manifests) {
    assert.equal(manifest.schemaId, 'atm.commandManifest.v1', `${code} recovery manifest schema`);
    assertNonEmptyString(manifest.executable, `${code} manifest executable`);
    assert(manifest.argv.length > 0, `${code} manifest argv`);
    assert.equal(manifest.shell, false, `${code} recovery manifest must be shellless`);
  }
}

const dimensionMismatch = entriesByCode.get('ATM_BROKER_AUTHORIZATION_DIMENSION_MISMATCH')!;
assert.match(
  JSON.stringify(dimensionMismatch),
  /resource dimension|requested resource dimension|granted resource dimension/i,
  'dimension mismatch contract must preserve requested/granted resource dimension language'
);
assert.match(
  JSON.stringify(dimensionMismatch),
  /Do not replace resource-dimension checks with task-id allowlists/i,
  'dimension mismatch contract must explicitly reject task-id allowlist recovery'
);

const destructiveWrite = entriesByCode.get('ATM_PROTECTED_GOVERNANCE_STATE_DESTRUCTIVE_WRITE')!;
assert.match(
  JSON.stringify(destructiveWrite),
  /delete|truncate|overwrite|reset/i,
  'protected governance state contract must name destructive write operations'
);
assert.match(
  JSON.stringify(destructiveWrite),
  /lifecycle|reconcile/i,
  'protected governance state contract must preserve lifecycle or reconcile disposition'
);

console.log('atm-3-error-contract.test passed');
