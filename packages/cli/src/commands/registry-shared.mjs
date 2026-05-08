import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSourceHashSnapshot } from '../../../core/src/hash-lock/hash-lock.mjs';
import { createRegistryDocument, evaluateRegistryEntryDrift, validateRegistryDocumentFile } from '../../../core/src/registry/registry.mjs';
import { makeResult, message, readJsonFile, relativePathFrom } from './shared.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
export const frameworkRepoRoot = repoRoot;
export const registrySchemaPath = path.join(repoRoot, 'schemas', 'registry.schema.json');
export const registryFilePath = path.join(repoRoot, 'atomic-registry.json');

export const seedRegistryEvidencePath = 'scripts/validate-seed-registry.mjs';
export const seedRegistryId = 'registry.seed';
export const seedGovernedByLegacyPlanningId = 'ATM-CORE-0002';

export function computeSeedRegistrySnapshot() {
  const seedModule = JSON.parse(readFileSync(path.join(repoRoot, 'specs/atom-seed-spec.json'), 'utf8'));
  const specPath = 'specs/atom-seed-spec.json';
  const codePath = 'packages/core/seed.js';
  const testPaths = [
    'scripts/validate-seed-spec.mjs',
    seedRegistryEvidencePath
  ];
  const selfVerification = createSourceHashSnapshot({
    repositoryRoot: repoRoot,
    specPath,
    codePaths: [codePath],
    testPaths,
    legacyPlanningId: 'ATM-CORE-0001'
  });

  return {
    generatedAt: '2026-05-06T17:00:00.000Z',
    entry: {
      atomId: seedModule.id,
      schemaId: seedModule.schemaId,
      specVersion: seedModule.specVersion,
      schemaPath: 'schemas/atomic-spec.schema.json',
      specPath,
      hashLock: seedModule.hashLock,
      owner: {
        name: 'ATM maintainers',
        contact: 'maintainers@example.invalid'
      },
      status: 'active',
      governance: {
        tier: 'governed'
      },
      compatibility: {
        coreVersion: seedModule.compatibility.coreVersion,
        registryVersion: seedModule.compatibility.registryVersion
      },
      evidence: [
        'scripts/validate-seed-spec.mjs',
        seedRegistryEvidencePath
      ],
      selfVerification
    }
  };
}

export function createSeedRegistryDocument() {
  const snapshot = computeSeedRegistrySnapshot();
  return createRegistryDocument([snapshot.entry], {
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Phase B1 seed governance registry.'
    },
    registryId: seedRegistryId,
    generatedAt: snapshot.generatedAt
  });
}

export function readRegistryDocument() {
  return readJsonFile(registryFilePath, 'ATM_REGISTRY_NOT_FOUND');
}

export function validateRegistryDocumentAgainstSchema(cwd, registryPath = registryFilePath, options = {}) {
  const commandName = options.commandName ?? 'verify';
  const successCode = options.successCode ?? 'ATM_VERIFY_REGISTRY_OK';
  const successText = options.successText ?? 'Registry document validated against JSON Schema.';
  const relativeRegistryPath = relativePathFrom(cwd, registryPath);
  const validation = validateRegistryDocumentFile(registryPath, { schemaPath: registrySchemaPath });
  const messages = validation.ok
    ? [message('info', successCode, successText)]
    : (validation.promptReport?.issues ?? []).map((issue) => message('error', issue.code ?? 'ATM_REGISTRY_SCHEMA_ERROR', issue.text ?? 'Registry schema validation failed.', { path: issue.path ?? '/' }));

  return makeResult({
    ok: validation.ok === true,
    command: commandName,
    cwd,
    messages,
    evidence: {
      registryPath: relativeRegistryPath,
      schemaPath: relativePathFrom(cwd, validation.schemaPath ?? registrySchemaPath),
      registryId: validation.document?.registryId ?? null,
      validated: validation.ok ? [relativeRegistryPath] : []
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
  const drift = evaluateRegistryEntryDrift(entry, { repositoryRoot: repoRoot });
  const report = {
    legacyPlanningId: {
      expected: 'ATM-CORE-0001',
      actual: actual.legacyPlanningId,
      ok: actual.legacyPlanningId === 'ATM-CORE-0001'
    },
    specHash: {
      expected: drift.report?.specHash?.actual ?? null,
      actual: actual.specHash,
      ok: actual.specHash === (drift.report?.specHash?.actual ?? null)
    },
    codeHash: {
      expected: drift.report?.codeHash?.actual ?? null,
      actual: actual.codeHash,
      ok: actual.codeHash === (drift.report?.codeHash?.actual ?? null)
    },
    testHash: {
      expected: drift.report?.testHash?.actual ?? null,
      actual: actual.testHash,
      ok: actual.testHash === (drift.report?.testHash?.actual ?? null)
    }
  };

  return {
    ok: Object.values(report).every((item) => item.ok === true),
    issues: Object.entries(report).filter(([, item]) => item.ok !== true).map(([key]) => key),
    report,
    entry
  };
}

export function evaluateSeedGovernance(registry = readRegistryDocument()) {
  const verification = evaluateSeedSelfVerification(registry);
  const atomStatus = verification.entry?.status ?? null;
  const governanceTier = verification.entry?.governance?.tier ?? null;
  const selfVerificationOk = verification.ok === true;
  const governed = atomStatus === 'active' && governanceTier === 'governed';

  return {
    ok: governed && selfVerificationOk,
    frameworkPhase: governed && selfVerificationOk ? 'B1-complete' : 'B1-incomplete',
    atomId: verification.entry?.atomId ?? null,
    atomStatus,
    governanceTier,
    legacyPlanningId: verification.report?.legacyPlanningId?.actual ?? null,
    governedByLegacyPlanningId: seedGovernedByLegacyPlanningId,
    selfVerificationOk,
    verificationIssues: verification.issues ?? []
  };
}