export const seedLegacyPlanningId = 'ATM-CORE-0001';
export const seedAtomId = 'ATM-CORE-0001';
export const seedLogicalName = 'atom.core-seed';
export const seedSpecPath = 'specs/atom-seed-spec.json';
export const seedSourcePath = 'packages/core/seed.js';

// @deprecated since ATM-CORE-0002 governs this hand-written seed source.
// Kept as deterministic provenance for self-description and self-verification.

export function createSeedAtomSpec() {
  return {
    schemaId: 'atm.atomicSpec',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Initial Phase B1 seed self-description.'
    },
    id: seedAtomId,
    logicalName: seedLogicalName,
    title: 'ATM Core Seed Self Descriptor',
    description: 'Canonical Atomic ID uses ATM-CORE-0001. The historical dot-notation name is preserved only as logicalName for human-readable namespace context.',
    language: {
      primary: 'javascript',
      sourceExtensions: ['.js'],
      tooling: ['node', 'ajv']
    },
    runtime: {
      kind: 'node',
      versionRange: '>=20',
      environment: 'local'
    },
    adapterRequirements: {
      projectAdapter: 'standalone-seed',
      storage: 'none',
      capabilities: ['filesystem', 'schema-validator', 'artifact-store', 'evidence-store']
    },
    compatibility: {
      coreVersion: '0.1.0',
      registryVersion: '0.1.0',
      pluginApiVersion: '0.1.0',
      languageAdapter: 'language-js'
    },
    hashLock: {
      algorithm: 'sha256',
      digest: 'sha256:24eb862d8e62b14f6f95b9b728d036827fee8ad0a683ee5cdd4a244b02bbe3c6',
      canonicalization: 'json-stable-v1'
    },
    dependencyPolicy: {
      external: 'workspace-only',
      hostCoupling: 'forbidden'
    },
    inputs: [
      {
        name: 'seedSource',
        kind: 'file',
        required: true
      }
    ],
    outputs: [
      {
        name: 'seedSpec',
        kind: 'file',
        required: true
      },
      {
        name: 'evidence',
        kind: 'evidence',
        required: true
      }
    ],
    validation: {
      commands: [
        'node atm.mjs spec --validate specs/atom-seed-spec.json',
        'node scripts/validate-seed-spec.mjs --mode validate'
      ],
      evidenceRequired: true
    },
    performanceBudget: {
      hotPath: false,
      inputMutation: 'forbidden',
      maxDurationMs: 250
    },
    tags: ['phase-b1', 'seed', 'self-descriptor']
  };
}

export const seedAtomSpec = Object.freeze(createSeedAtomSpec());
