import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProfile } from '../profile-loader.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../../../../');

// 1. 測試 valid profile 讀取
const validPath = path.join(rootDir, 'fixtures/taskflow-profile/valid.profile.json');
const valid = loadProfile(validPath);
assert.equal(valid.schemaId, 'taskflow.profile.v1');
assert.equal(valid.name, 'Adopter Planning Repo Profile');
assert.equal(valid.capabilities.supportsWrite, false);

// 2. 測試 missing schemaId 的 profile 讀取
const invalidPath = path.join(rootDir, 'fixtures/taskflow-profile/invalid-missing-schema-id.profile.json');
assert.throws(() => {
  loadProfile(invalidPath);
}, (err: any) => {
  return err.code === 'ATM_TASKFLOW_PROFILE_INVALID_SCHEMA_ID';
});

// 3. 測試不存在的 profile 讀取
const missingPath = path.join(rootDir, 'fixtures/taskflow-profile/does-not-exist.json');
assert.throws(() => {
  loadProfile(missingPath);
}, (err: any) => {
  return err.code === 'ATM_TASKFLOW_PROFILE_NOT_FOUND';
});

console.log('[taskflow-profile-loader:test] ok');
