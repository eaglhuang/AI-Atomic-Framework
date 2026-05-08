import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  createAtomicMapSemanticFingerprint,
  createAtomicSpecSemanticFingerprint,
  normalizeSemanticFingerprint
} from '../packages/core/src/registry/semantic-fingerprint.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const schemaPaths = {
  atomicSpec: 'schemas/atomic-spec.schema.json',
  atomicMap: 'schemas/registry/atomic-map.schema.json',
  registry: 'schemas/registry.schema.json',
  registryV1: 'packages/core/src/registry/registry-v1.schema.json',
  versionIndex: 'schemas/registry/version-index.schema.json'
};

const fixturePaths = {
  atomWithSf: 'fixtures/registry/atom-with-sf.json',
  legacyNoSf: 'fixtures/registry/legacy-no-sf.json',
  mapWithSf: 'fixtures/registry/map-with-sf.json',
  pendingSfCalculation: 'fixtures/registry/pending-sf-calculation.json',
  registryV1: 'fixtures/registry/v1-with-versions.json',
  versionIndex: 'fixtures/registry/version-index.json'
};

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const schemas = Object.fromEntries(
  Object.entries(schemaPaths).map(([key, relativePath]) => [key, readJson(relativePath)])
);

for (const [key, schema] of Object.entries(schemas)) {
  if (!ajv.validateSchema(schema)) {
    fail(`schema ${schemaPaths[key]} is invalid JSON Schema: ${formatErrors(ajv.errors)}`);
  }
}

const validators = Object.fromEntries(
  Object.entries(schemas).map(([key, schema]) => [key, ajv.compile(schema)])
);

const atomWithSf = readJson(fixturePaths.atomWithSf);
const legacyNoSf = readJson(fixturePaths.legacyNoSf);
const mapWithSf = readJson(fixturePaths.mapWithSf);
const pendingSfCalculation = readJson(fixturePaths.pendingSfCalculation);
const registryV1 = readJson(fixturePaths.registryV1);
const versionIndex = readJson(fixturePaths.versionIndex);
const helloWorldAtom = readJson('tests/schema-fixtures/positive/hello-world.atom.json');

validateDocument('atom-with-sf', validators.atomicSpec, atomWithSf, fixturePaths.atomWithSf);
validateDocument('legacy-no-sf', validators.atomicSpec, legacyNoSf, fixturePaths.legacyNoSf);
validateDocument('map-with-sf', validators.atomicMap, mapWithSf, fixturePaths.mapWithSf);
validateDocument('pending-sf-calculation', validators.atomicMap, pendingSfCalculation, fixturePaths.pendingSfCalculation);
validateDocument('registry-v1', validators.registryV1, registryV1, fixturePaths.registryV1);
validateDocument('version-index', validators.versionIndex, versionIndex, fixturePaths.versionIndex);

check(
  normalizeSemanticFingerprint(atomWithSf.semanticFingerprint) === createAtomicSpecSemanticFingerprint(atomWithSf),
  'atom-with-sf semantic fingerprint must match the canonical atomic-spec hash'
);
check(
  atomWithSf.deployScope === 'all-env',
  'atom-with-sf must carry deployScope all-env'
);
check(
  atomWithSf.mutabilityPolicy === 'mutable',
  'atom-with-sf must carry mutabilityPolicy mutable'
);
check(
  atomWithSf.lineage?.bornBy === 'codex-gpt-5.5' && Array.isArray(atomWithSf.lineage?.parentRefs),
  'atom-with-sf must keep lineage metadata in the spec'
);
check(
  atomWithSf.ttl?.expiresAt === '2026-12-31T23:59:59.000Z',
  'atom-with-sf must keep ttl metadata in the spec'
);
check(
  !Object.hasOwn(legacyNoSf, 'semanticFingerprint') && !Object.hasOwn(legacyNoSf, 'lineage') && !Object.hasOwn(legacyNoSf, 'ttl'),
  'legacy-no-sf must stay free of semantic fingerprint governance fields'
);
check(
  normalizeSemanticFingerprint(mapWithSf.semanticFingerprint) === createAtomicMapSemanticFingerprint(mapWithSf),
  'map-with-sf semantic fingerprint must match the canonical atomic-map hash'
);
check(
  !Object.hasOwn(mapWithSf, 'pendingSfCalculation'),
  'map-with-sf must not be marked as pending'
);
check(
  pendingSfCalculation.pendingSfCalculation === true,
  'pending-sf-calculation must opt into pendingSfCalculation'
);
check(
  pendingSfCalculation.semanticFingerprint === null,
  'pending-sf-calculation must leave semanticFingerprint null until the calculator runs'
);
check(
  normalizeSemanticFingerprint(createAtomicMapSemanticFingerprint(pendingSfCalculation))
    === normalizeSemanticFingerprint(mapWithSf.semanticFingerprint),
  'pending-sf-calculation should resolve to the same canonical fingerprint once calculation runs'
);

const historyEntry = Array.isArray(registryV1.entries)
  ? registryV1.entries.find((entry) => entry.atomId === 'ATM-FIXTURE-0001')
  : null;
check(Boolean(historyEntry), 'registry-v1 must include ATM-FIXTURE-0001');
check(historyEntry.currentVersion === '1.1.0', 'registry-v1 must carry currentVersion as the hot pointer');
check(Array.isArray(historyEntry.versions) && historyEntry.versions.length === 2, 'registry-v1 must keep version history in versions[]');
check(
  historyEntry.versions.every((versionRecord) => typeof versionRecord.semanticFingerprint === 'string'),
  'registry-v1 version history must store semanticFingerprint per version'
);
check(
  historyEntry.versions.every((versionRecord) => normalizeSemanticFingerprint(versionRecord.semanticFingerprint) === createAtomicSpecSemanticFingerprint(helloWorldAtom)),
  'registry-v1 version fingerprints must match the canonical hello-world atomic spec hash'
);
check(
  normalizeSemanticFingerprint(historyEntry.semanticFingerprint)
    === normalizeSemanticFingerprint(historyEntry.versions[historyEntry.versions.length - 1].semanticFingerprint),
  'registry-v1 hot semanticFingerprint must mirror the current version record'
);
check(
  typeof historyEntry.lineageLogRef === 'string' && typeof historyEntry.evidenceIndexRef === 'string' && typeof historyEntry.ttl === 'number',
  'registry-v1 must keep lineageLogRef, evidenceIndexRef, and ttl on the hot entry'
);

for (const [logicalName, row] of Object.entries(versionIndex)) {
  check(
    Array.isArray(row.versions) && row.versions.length > 0,
    `version-index row ${logicalName} must keep a non-empty versions[] list`
  );
  check(
    row.latest === row.versions[row.versions.length - 1],
    `version-index row ${logicalName} must keep latest as the newest version`
  );
  check(
    new Set(row.versions).size === row.versions.length,
    `version-index row ${logicalName} must keep versions[] unique`
  );
}

if (!process.exitCode) {
  console.log(
    `[semantic-fingerprint:${mode}] ok (atom-with-sf, legacy-no-sf, map-with-sf, pending-sf-calculation, registry-v1, version-index)`
  );
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function validateDocument(label, validate, document, relativePath) {
  check(validate(document) === true, `${label} failed schema validation (${relativePath}): ${formatErrors(validate.errors)}`);
}

function check(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function fail(message) {
  console.error(`[semantic-fingerprint:${mode}] ${message}`);
  process.exitCode = 1;
}

function formatErrors(errors) {
  return (errors || [])
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}
