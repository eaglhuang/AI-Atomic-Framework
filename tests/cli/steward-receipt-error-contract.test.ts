import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  ATM_ERROR_CODE_REGISTRY,
  ATM_ERROR_CODE_REGISTRY_DIGEST
} from '../../packages/core/src/error-code-registry.generated.ts';

type CommandManifest = {
  readonly schemaId: string;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly shell: boolean;
};

type RegistryEntry = {
  readonly code: string;
  readonly category: string;
  readonly retryable: boolean;
  readonly requiresHumanApproval: boolean;
  readonly sourceOwner: string;
  readonly registryOwner?: string;
  readonly trigger?: string;
  readonly requiredEvidence?: readonly string[];
  readonly statusCommand?: string;
  readonly recoveryManifests?: readonly CommandManifest[];
  readonly relatedCommands: readonly string[];
};

const requiredContracts = {
  ATM_BROKER_STEWARD_RECEIPT_REQUIRED: {
    category: 'team-broker',
    sourceOwner: 'packages/core/src/broker/shared-write-provenance-policy.ts'
  },
  ATM_BROKER_STEWARD_RECEIPT_INVALID: {
    category: 'team-broker',
    sourceOwner: 'packages/core/src/broker/shared-write-provenance-policy.ts'
  }
} as const;

const registryText = readFileSync('docs/governance/error-code-registry.json', 'utf8');
const registry = JSON.parse(registryText) as {
  readonly schemaId: string;
  readonly specVersion: string;
  readonly entries: readonly RegistryEntry[];
};
const docs = readFileSync('docs/ERROR_CODES.md', 'utf8');
const entriesByCode = new Map(registry.entries.map((entry) => [entry.code, entry]));

for (const [code, expected] of Object.entries(requiredContracts)) {
  const entry = entriesByCode.get(code);
  assert(entry, `${code} must have one exact canonical registry entry`);
  assert.equal(entry.category, expected.category, `${code} category`);
  assert.equal(entry.sourceOwner, expected.sourceOwner, `${code} source owner`);
  assert.equal(entry.registryOwner, 'TASK-ERR-0004', `${code} registry owner`);
  assert.equal(entry.retryable, true, `${code} retryability`);
  assert.equal(entry.requiresHumanApproval, false, `${code} approval policy`);
  assert(entry.trigger && entry.trigger.trim().length > 0, `${code} exact trigger`);
  assert(entry.requiredEvidence && entry.requiredEvidence.length > 0, `${code} required evidence`);
  assert(entry.statusCommand && entry.statusCommand.trim().length > 0, `${code} status command`);
  assert(entry.relatedCommands.length > 0, `${code} required-command presence`);
  assert(
    entry.relatedCommands.some((command) => command.includes('broker compose') || command.includes('broker steward')),
    `${code} required command routes back through broker compose/steward delivery`
  );

  const manifests = entry.recoveryManifests ?? [];
  assert(manifests.length > 0, `${code} recovery manifest`);
  for (const manifest of manifests) {
    assert.equal(manifest.schemaId, 'atm.commandManifest.v1', `${code} manifest schema`);
    assert.equal(manifest.executable, 'node', `${code} manifest executable`);
    assert(manifest.argv.length > 0, `${code} manifest argv`);
    assert.equal(manifest.shell, false, `${code} manifest shell policy`);
  }

  assert(docs.includes('| `' + code + '`'), `${code} generated documentation row`);
}

// The two codes must remain distinct: absent evidence vs. present-but-untrustworthy evidence.
const required = entriesByCode.get('ATM_BROKER_STEWARD_RECEIPT_REQUIRED');
const invalid = entriesByCode.get('ATM_BROKER_STEWARD_RECEIPT_INVALID');
assert(required && invalid, 'both steward-receipt contracts must be registered');
assert.notEqual(required.trigger, invalid.trigger, 'the two codes must have distinct triggers');
assert(
  /no consumed steward receipt/.test(required.trigger ?? ''),
  'ATM_BROKER_STEWARD_RECEIPT_REQUIRED trigger describes absent evidence'
);
assert(
  /(malformed|stale|consumed|mismatch|canonicalWriteCount)/i.test(invalid.trigger ?? ''),
  'ATM_BROKER_STEWARD_RECEIPT_INVALID trigger describes present-but-untrustworthy evidence'
);

const expectedDigest = `sha256:${createHash('sha256').update(JSON.stringify(registry)).digest('hex')}`;
assert.equal(ATM_ERROR_CODE_REGISTRY_DIGEST, expectedDigest, 'generated TypeScript registry digest');
assert.deepEqual(ATM_ERROR_CODE_REGISTRY, registry, 'generated TypeScript registry content');
assert.match(docs, new RegExp(expectedDigest), 'generated documentation must expose the canonical registry digest');

console.log('steward-receipt-error-contract.test passed');
