import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { makeResult, message, readJsonFile, relativePathFrom } from './shared.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
export const registrySchemaPath = path.join(repoRoot, 'schemas', 'registry.schema.json');
export const registryFilePath = path.join(repoRoot, 'atomic-registry.json');
const require = createRequire(import.meta.url);

export const seedRegistryEvidencePath = 'scripts/validate-seed-registry.mjs';
export const seedRegistryId = 'registry.seed';

export function computeSeedRegistrySnapshot() {
  const seedModule = JSON.parse(readFileSync(path.join(repoRoot, 'specs/atom-seed-spec.json'), 'utf8'));
  const specHash = sha256ForFile(path.join(repoRoot, 'specs/atom-seed-spec.json'));
  const codeHash = sha256ForFile(path.join(repoRoot, 'packages/core/seed.js'));
  const testHash = sha256ForFiles([
    path.join(repoRoot, 'scripts/validate-seed-spec.mjs'),
    path.join(repoRoot, 'scripts/validate-seed-registry.mjs')
  ]);

  return {
    generatedAt: '2026-05-06T17:00:00.000Z',
    entry: {
      atomId: seedModule.id,
      schemaId: seedModule.schemaId,
      specVersion: seedModule.specVersion,
      schemaPath: 'schemas/atomic-spec.schema.json',
      specPath: 'specs/atom-seed-spec.json',
      hashLock: seedModule.hashLock,
      owner: {
        name: 'ATM maintainers',
        contact: 'maintainers@example.invalid'
      },
      status: 'seed',
      compatibility: {
        coreVersion: seedModule.compatibility.coreVersion,
        registryVersion: seedModule.compatibility.registryVersion
      },
      evidence: [
        'scripts/validate-seed-spec.mjs',
        seedRegistryEvidencePath
      ],
      selfVerification: {
        legacyPlanningId: 'ATM-CORE-0001',
        specHash,
        codeHash,
        testHash,
        sourcePaths: {
          spec: 'specs/atom-seed-spec.json',
          code: 'packages/core/seed.js',
          tests: [
            'scripts/validate-seed-spec.mjs',
            seedRegistryEvidencePath
          ]
        }
      }
    }
  };
}

export function createSeedRegistryDocument() {
  const snapshot = computeSeedRegistrySnapshot();
  return {
    schemaId: 'atm.registry',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Initial Phase B1 seed self-verification registry.'
    },
    registryId: seedRegistryId,
    generatedAt: snapshot.generatedAt,
    entries: [snapshot.entry]
  };
}

export function readRegistryDocument() {
  return readJsonFile(registryFilePath, 'ATM_REGISTRY_NOT_FOUND');
}

export function validateRegistryDocumentAgainstSchema(cwd, registryPath = registryFilePath, options = {}) {
  const commandName = options.commandName ?? 'verify';
  const successCode = options.successCode ?? 'ATM_VERIFY_REGISTRY_OK';
  const successText = options.successText ?? 'Registry document validated against JSON Schema.';
  const relativeRegistryPath = relativePathFrom(cwd, registryPath);

  if (!existsSync(registryPath)) {
    return makeResult({
      ok: false,
      command: commandName,
      cwd,
      messages: [message('error', 'ATM_REGISTRY_NOT_FOUND', 'Atomic registry file was not found.', { registryPath: relativeRegistryPath })],
      evidence: {
        registryPath: relativeRegistryPath,
        validated: []
      }
    });
  }

  let ajv;
  try {
    const Ajv2020 = require('ajv/dist/2020.js');
    const addFormats = require('ajv-formats');
    const AjvConstructor = Ajv2020.default ?? Ajv2020;
    const addFormatsPlugin = addFormats.default ?? addFormats;
    ajv = new AjvConstructor({ allErrors: true, strict: false });
    addFormatsPlugin(ajv);
  } catch (error) {
    return makeResult({
      ok: false,
      command: commandName,
      cwd,
      messages: [message('error', 'ATM_REGISTRY_VALIDATOR_UNAVAILABLE', 'AJV validator is not available in this environment.', { reason: error instanceof Error ? error.message : String(error) })],
      evidence: {
        registryPath: relativeRegistryPath,
        schemaPath: relativePathFrom(cwd, registrySchemaPath),
        validated: []
      }
    });
  }

  const schema = JSON.parse(readFileSync(registrySchemaPath, 'utf8'));
  const registry = readJsonFile(registryPath, 'ATM_REGISTRY_NOT_FOUND');
  const validate = ajv.compile(schema);
  const valid = validate(registry);
  const messages = valid
    ? [message('info', successCode, successText)]
    : (validate.errors || []).map((error) => message('error', 'ATM_REGISTRY_SCHEMA_ERROR', `${error.instancePath || '/'} ${error.message}.`, { path: error.instancePath || '/' }));

  return makeResult({
    ok: valid === true,
    command: commandName,
    cwd,
    messages,
    evidence: {
      registryPath: relativeRegistryPath,
      schemaPath: relativePathFrom(cwd, registrySchemaPath),
      registryId: registry.registryId,
      validated: valid ? [relativeRegistryPath] : []
    }
  });
}

export function evaluateSeedSelfVerification(registry = readRegistryDocument()) {
  const expected = computeSeedRegistrySnapshot();
  const entry = registry.entries?.find((candidate) => candidate.atomId === expected.entry.atomId);
  if (!entry) {
    return {
      ok: false,
      issues: ['missing-entry'],
      report: null
    };
  }

  const actual = entry.selfVerification || {};
  const report = {
    legacyPlanningId: {
      expected: 'ATM-CORE-0001',
      actual: actual.legacyPlanningId,
      ok: actual.legacyPlanningId === 'ATM-CORE-0001'
    },
    specHash: {
      expected: expected.entry.selfVerification.specHash,
      actual: actual.specHash,
      ok: actual.specHash === expected.entry.selfVerification.specHash
    },
    codeHash: {
      expected: expected.entry.selfVerification.codeHash,
      actual: actual.codeHash,
      ok: actual.codeHash === expected.entry.selfVerification.codeHash
    },
    testHash: {
      expected: expected.entry.selfVerification.testHash,
      actual: actual.testHash,
      ok: actual.testHash === expected.entry.selfVerification.testHash
    }
  };

  return {
    ok: Object.values(report).every((item) => item.ok === true),
    issues: Object.entries(report).filter(([, item]) => item.ok !== true).map(([key]) => key),
    report,
    entry
  };
}

function sha256ForFile(filePath) {
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

function sha256ForFiles(filePaths) {
  const hash = createHash('sha256');
  for (const filePath of filePaths) {
    hash.update(readFileSync(filePath));
  }
  return `sha256:${hash.digest('hex')}`;
}