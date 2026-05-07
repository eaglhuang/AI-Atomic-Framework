import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistryIndex, RegistryIndexError, semanticFingerprintPrefix } from '../packages/core/src/registry/registry-index.mjs';
import { formatAtmUrn, normalizeAtmNodeRef, parseAtmUrn } from '../packages/core/src/registry/urn.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = readJson('fixtures/registry/index/registry-index-fixture.json');

function fail(message) {
  console.error(`[registry-index:${mode}] ${message}`);
  process.exitCode = 1;
}

function check(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function expectThrows(callback, code, message) {
  try {
    callback();
  } catch (error) {
    check(error.code === code, `${message}: expected ${code}, got ${error.code ?? error.message}`);
    return;
  }
  fail(`${message}: expected throw ${code}`);
}

const formattedAtom = formatAtmUrn({ nodeKind: 'atom', canonicalId: 'ATM-CORE-0001', version: '1.2.0' });
check(formattedAtom === 'urn:atm:atom:ATM-CORE-0001@1.2.0', 'formatAtmUrn must derive atom URNs from canonical IDs');
const parsedAtom = parseAtmUrn(formattedAtom);
check(parsedAtom.nodeKind === 'atom' && parsedAtom.canonicalId === 'ATM-CORE-0001' && parsedAtom.version === '1.2.0', 'parseAtmUrn must parse atom URNs');

const formattedMap = formatAtmUrn({ nodeKind: 'map', canonicalId: 'ATM-MAP-0001', version: '0.1.0' });
check(formattedMap === 'urn:atm:map:ATM-MAP-0001@0.1.0', 'formatAtmUrn must derive map URNs from canonical map IDs');
check(normalizeAtmNodeRef('ATM-MAP-0001').nodeKind === 'map', 'normalizeAtmNodeRef must infer map node kind from ATM-MAP IDs');
check(normalizeAtmNodeRef('ATM-CORE-0001').nodeKind === 'atom', 'normalizeAtmNodeRef must infer atom node kind from ATM bucket IDs');

const invalidUrnExpectations = new Map([
  ['urn:atm:atom:atom.core-seed@1.0.0', 'ATM_ATOM_ID_INVALID'],
  ['urn:atm:map:ATM-CORE-0001@1.0.0', 'ATM_MAP_ID_INVALID'],
  ['urn:atm:atom:ATM-MAP-0001@1.0.0', 'ATM_ATOM_ID_INVALID'],
  ['urn:atm:atom:ATM-CORE-0001@v1', 'ATM_URN_INVALID']
]);

for (const invalidUrn of fixture.invalidUrns) {
  expectThrows(() => parseAtmUrn(invalidUrn), invalidUrnExpectations.get(invalidUrn), `invalid URN must fail: ${invalidUrn}`);
}

const index = createRegistryIndex(fixture.validRegistry);
check(index.size === 3, 'RegistryIndex must include atom and map node refs');
check(index.getByCanonicalId('ATM-CORE-0001')?.urn === formattedAtom, 'RegistryIndex must lookup atoms by canonical ID');
check(index.getByUrn(formattedMap)?.canonicalId === 'ATM-MAP-0001', 'RegistryIndex must lookup maps by derived URN');
check(index.findByLogicalName('atom.core-seed').length === 1, 'RegistryIndex must lookup logicalName via O(1) map');
check(index.findByLogicalName('atom.legacy-no-sf').length === 1, 'RegistryIndex must keep legacy entries without semantic fingerprint');
check(index.getVersions('ATM-CORE-0001').versions.join(',') === '1.2.0,1.0.0', 'RegistryIndex must preserve current and historical versions');

const atomPrefix = semanticFingerprintPrefix('sha256:1111111111111111111111111111111111111111111111111111111111111111');
check(atomPrefix === '1111111111111111', 'semanticFingerprintPrefix must derive 16-char hash bucket keys');
check(index.findByFingerprintPrefix(atomPrefix).length === 1, 'RegistryIndex must lookup fingerprint prefix buckets');
check(index.findBySemanticFingerprint('sha256:1111111111111111111111111111111111111111111111111111111111111111').length === 1, 'RegistryIndex must lookup full semantic fingerprints');
check(index.findByFingerprintPrefix('3333333333333333').length === 0, 'RegistryIndex must not add no-sf legacy entries to fingerprint buckets');

expectThrows(() => createRegistryIndex(fixture.duplicateRegistry), 'ATM_REGISTRY_INDEX_DUPLICATE_KEY', 'duplicate canonical IDs must fail fast');
expectThrows(() => semanticFingerprintPrefix('not-a-fingerprint'), 'ATM_SEMANTIC_FINGERPRINT_INVALID', 'invalid semantic fingerprints must fail fast');

if (!process.exitCode) {
  console.log(`[registry-index:${mode}] ok (URN resolver, O(1) indexes, legacy-no-sf, duplicate guard)`);
}