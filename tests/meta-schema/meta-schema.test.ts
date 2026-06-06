import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installManifestSchemaVersion, legacyInstallManifestSchemaVersion, readInstallManifestSchemaVersion } from '../../packages/agent-pack-sdk/src/install-manifest.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const legacyManifest = JSON.parse(readFileSync(path.join(root, 'tests/meta-schema/legacy-install-manifest.json'), 'utf8'));
const legacy = readInstallManifestSchemaVersion(legacyManifest);
assert.equal(legacy.schemaVersion, legacyInstallManifestSchemaVersion);
assert.equal(legacy.isLegacy, true);
assert.equal(legacy.warnings[0]?.code, 'ATM_INSTALL_MANIFEST_LEGACY_SCHEMA_VERSION');

const currentManifest = JSON.parse(readFileSync(path.join(root, 'tests/meta-schema/new-install-manifest.json'), 'utf8'));
const current = readInstallManifestSchemaVersion(currentManifest);
assert.equal(current.schemaVersion, installManifestSchemaVersion);
assert.equal(current.warnings.length, 0);

const validator = spawnSync(process.execPath, ['--strip-types', path.join(root, 'scripts/validate-meta-schema.ts'), '--mode', 'test'], {
  cwd: root,
  encoding: 'utf8'
});
assert.equal(validator.status, 0, `${validator.stdout}\n${validator.stderr}`);

console.log('[meta-schema-test] ok');
