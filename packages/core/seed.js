export const seedLegacyPlanningId = 'ATM-CORE-0001';
export const seedAtomId = 'atom.core-seed';
export const seedSpecPath = 'specs/atom-seed-spec.json';
export const seedSourcePath = 'packages/core/seed.js';

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
    title: 'ATM Core Seed Self Descriptor',
    description: 'Legacy planning ID ATM-CORE-0001 maps to atom.core-seed in the current atomic-spec vocabulary. This spec describes the handwritten core seed with the same format used for other atoms.',
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
      digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
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
        'node packages/cli/src/atm.mjs spec --validate specs/atom-seed-spec.json',
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