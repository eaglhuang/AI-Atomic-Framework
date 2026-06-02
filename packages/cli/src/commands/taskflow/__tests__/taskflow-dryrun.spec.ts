import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTaskflow } from '../../taskflow.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../../../../');

// 1. 測試 open --dry-run 無 profile
const res1 = runTaskflow(['open', '--dry-run']);
assert.equal(res1.ok, true);
assert.equal(res1.mode, 'dry-run');
assert.equal(res1.schemaId, 'atm.taskflowOpenResult.v1');
assert.equal(res1.writeEnabled, false);

// 2. 測試 open --dry-run 有 valid profile
const validProfilePath = path.join(rootDir, 'fixtures/taskflow-profile/valid.profile.json');
const res2 = runTaskflow(['open', '--dry-run', '--profile', validProfilePath]) as any;
assert.equal(res2.ok, true);
assert.equal(res2.mode, 'dry-run');
assert.equal(res2.evidence.profile.schemaId, 'taskflow.profile.v1');
assert.equal(res2.evidence.profile.name, 'Adopter Planning Repo Profile');

// 3. 測試 open --write 被拒絕
assert.throws(() => {
  runTaskflow(['open', '--write']);
}, (err: any) => {
  return err.code === 'ATM_TASKFLOW_WRITE_MODE_NOT_SUPPORTED';
});

// 4. 測試 open --dry-run 有 invalid profile 被拒絕
const invalidProfilePath = path.join(rootDir, 'fixtures/taskflow-profile/invalid-missing-schema-id.profile.json');
assert.throws(() => {
  runTaskflow(['open', '--dry-run', '--profile', invalidProfilePath]);
}, (err: any) => {
  return err.code === 'ATM_TASKFLOW_PROFILE_INVALID_SCHEMA_ID';
});

console.log('[taskflow-dryrun:test] ok');
