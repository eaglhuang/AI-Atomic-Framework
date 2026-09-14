import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultAtomicSpecSchemaPath, parseAtomicSpecDocument } from '../../packages/core/src/spec/parse-spec.ts';
import { createAtomicRegistryEntry } from '../../packages/core/src/registry/registry/entry.ts';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-registry-portability-'));
try {
  const specPath = path.join(tempRoot, 'atomic_workbench/atoms/ATM-CORE-0001/atom.spec.json');
  const sourcePath = path.join(tempRoot, 'atomic_workbench/atoms/ATM-CORE-0001/atom.source.mjs');
  const testPath = path.join(tempRoot, 'atomic_workbench/atoms/ATM-CORE-0001/atom.test.ts');
  mkdirSync(path.dirname(specPath), { recursive: true });
  const spec = {
    schemaId: 'atm.atomicSpec',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'test' },
    id: 'ATM-CORE-0001',
    logicalName: 'atom.core-portability',
    title: 'Portability',
    description: 'Registry portability test.',
    language: { primary: 'javascript', sourceExtensions: ['.mjs'], tooling: ['node'] },
    runtime: { kind: 'node', versionRange: '>=20', environment: 'local' },
    adapterRequirements: { projectAdapter: 'local-fs', storage: 'local-fs', capabilities: ['filesystem'] },
    compatibility: { coreVersion: '0.1.0', registryVersion: '0.1.0', languageAdapter: 'language-js' },
    hashLock: { algorithm: 'sha256', digest: 'sha256:' + 'a'.repeat(64), canonicalization: 'json-stable-v1' },
    dependencyPolicy: { external: 'workspace-only', hostCoupling: 'forbidden' },
    inputs: [{ name: 'request', kind: 'json', required: true }],
    outputs: [{ name: 'result', kind: 'json', required: true }],
    validation: { commands: ['node atom.source.mjs --self-check'], evidenceRequired: true },
    performanceBudget: { hotPath: false, inputMutation: 'forbidden', maxDurationMs: 1000 },
    tags: ['test']
  };
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  writeFileSync(sourcePath, 'export const ok = true;\n', 'utf8');
  writeFileSync(testPath, 'export const ok = true;\n', 'utf8');
  const parsed = parseAtomicSpecDocument(spec, { specPath });
  assert.equal(parsed.ok, true);
  const entry = createAtomicRegistryEntry(parsed.normalizedModel!, {
    repositoryRoot: tempRoot,
    schemaPath: defaultAtomicSpecSchemaPath,
    codePaths: ['atomic_workbench/atoms/ATM-CORE-0001/atom.source.mjs'],
    testPaths: ['atomic_workbench/atoms/ATM-CORE-0001/atom.test.ts']
  });
  assert.equal(typeof entry.schemaPath, 'string');
  assert.match(entry.schemaPath as string, /^schemas\/.+\.schema\.json$/);
  assert.equal(entry.selfVerification.sourcePaths.spec, 'atomic_workbench/atoms/ATM-CORE-0001/atom.spec.json');
  assert.match(entry.selfVerification.specHash, /^sha256:[a-f0-9]{64}$/);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[registry-entry-portability:test] ok');
