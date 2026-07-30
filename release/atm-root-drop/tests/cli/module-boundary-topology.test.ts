import assert from 'node:assert/strict';
import {
  evaluateModuleBoundaries,
  type ModuleBoundaryPolicy
} from '../../packages/core/src/architecture/index.ts';
import { scanTypeScriptDependencyGraph } from '../../scripts/validate-module-boundaries/implementation.ts';

const passingPolicy: ModuleBoundaryPolicy = {
  schemaId: 'atm.moduleBoundaryPolicy.v1',
  specVersion: '0.1.0',
  migration: {
    strategy: 'none',
    fromVersion: null,
    notes: 'Fixture policy.'
  },
  mode: 'shadow',
  modules: [
    {
      id: 'public-api',
      roots: ['modules/public-api'],
      publicEntrypoints: ['modules/public-api/index.ts'],
      allowedConsumers: ['consumer']
    },
    {
      id: 'consumer',
      roots: ['modules/consumer'],
      publicEntrypoints: ['modules/consumer/index.ts'],
      allowedConsumers: ['*'],
      allowedDependencies: ['public-api']
    },
    {
      id: 'adapter-a',
      roots: ['modules/adapter-a'],
      publicEntrypoints: ['modules/adapter-a/index.ts'],
      allowedConsumers: ['consumer'],
      adapterLanguages: ['typescript']
    },
    {
      id: 'adapter-b',
      roots: ['modules/adapter-b'],
      publicEntrypoints: ['modules/adapter-b/index.ts'],
      allowedConsumers: ['consumer'],
      adapterLanguages: ['typescript']
    }
  ],
  exceptions: [],
  sourceDiscovery: [
    {
      adapterId: 'typescript-static-imports',
      language: 'typescript',
      roots: ['modules'],
      extensions: ['.ts']
    },
    {
      adapterId: 'python-static-imports',
      language: 'python',
      roots: ['py'],
      extensions: ['.py']
    }
  ]
};

const passingGraph = scanTypeScriptDependencyGraph({
  root: 'tests/fixtures/module-boundaries/passing',
  policy: passingPolicy
});
const passingReceipt = evaluateModuleBoundaries({
  policy: passingPolicy,
  graph: passingGraph,
  today: '2026-07-30'
});
assert.equal(passingReceipt.ok, true);
assert.equal(passingReceipt.mode, 'shadow');
assert.equal(passingReceipt.findings.length, 0);
assert.equal(passingPolicy.modules.filter((module) => module.id.startsWith('adapter-')).length, 2);

const failingPolicy: ModuleBoundaryPolicy = {
  ...passingPolicy,
  modules: [
    ...passingPolicy.modules,
    {
      id: 'unlisted',
      roots: ['modules/unlisted'],
      publicEntrypoints: ['modules/unlisted/index.ts'],
      allowedConsumers: []
    },
    {
      id: 'cycle-a',
      roots: ['modules/a'],
      publicEntrypoints: ['modules/a/index.ts'],
      allowedConsumers: ['cycle-b']
    },
    {
      id: 'cycle-b',
      roots: ['modules/b'],
      publicEntrypoints: ['modules/b/index.ts'],
      allowedConsumers: ['cycle-a']
    }
  ],
  exceptions: [
    {
      id: 'expired-public-api-internal',
      fromModule: 'consumer',
      toModule: 'public-api',
      match: 'internal.ts',
      reason: 'legacy migration window',
      expiresOn: '2026-01-01'
    }
  ]
};

const failingGraph = scanTypeScriptDependencyGraph({
  root: 'tests/fixtures/module-boundaries/failing',
  policy: failingPolicy
});
const failingReceipt = evaluateModuleBoundaries({
  policy: failingPolicy,
  graph: failingGraph,
  today: '2026-07-30',
  sourceDigest: 'sha256:source',
  configDigest: 'sha256:config',
  candidateDigest: 'sha256:candidate'
});
assert.equal(failingReceipt.ok, false);
assert.equal(failingReceipt.sourceDigest, 'sha256:source');
assert.equal(failingReceipt.configDigest, 'sha256:config');
assert.equal(failingReceipt.candidateDigest, 'sha256:candidate');
assert(failingReceipt.findings.some((finding) => finding.code === 'ATM_MODULE_BOUNDARY_DEEP_IMPORT'));
assert(failingReceipt.findings.some((finding) => finding.code === 'ATM_MODULE_BOUNDARY_UNDECLARED_EDGE'));
assert(failingReceipt.findings.some((finding) => finding.code === 'ATM_MODULE_BOUNDARY_EXPIRED_EXCEPTION'));
assert(failingReceipt.findings.some((finding) => finding.code === 'ATM_MODULE_BOUNDARY_CYCLE'));
assert(failingReceipt.findings.every((finding) => finding.message.length > 0));

const unsupportedReceipt = evaluateModuleBoundaries({
  policy: passingPolicy,
  graph: {
    schemaId: 'atm.moduleBoundaryDependencyGraph.v1',
    specVersion: '0.1.0',
    adapterId: 'ruby-static-imports',
    language: 'ruby',
    sourceRoot: 'fixtures',
    edges: []
  }
});
assert.equal(unsupportedReceipt.ok, true);
assert.equal(unsupportedReceipt.unsupportedLanguage, true);
assert(unsupportedReceipt.findings.some((finding) => finding.code === 'ATM_MODULE_BOUNDARY_UNSUPPORTED_LANGUAGE'));
