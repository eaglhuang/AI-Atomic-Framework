import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTaskflow } from '../../taskflow.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../../../../');
// 1. 測試 open --dry-run 無 profile
const res1 = runTaskflow(['open', '--dry-run']);
assert.equal(res1.ok, true);
assert.equal(res1.mode, 'dry-run');
assert.equal(res1.schemaId, 'atm.taskflowOpenResult.v1');
assert.equal(res1.writeEnabled, false);
// 檢查無 profile 時的 adopter-neutral 預設值，不含有 hard-code 的 TASK-AAO-0113 等
assert.equal(res1.evidence.wouldDo[0].workItemId, 'TASK-ADOPTER-0001');
assert.equal(res1.evidence.wouldDo[0].targetRepo, 'adopter-repo');
// 2. 測試 open --dry-run 有 valid profile
const validProfilePath = path.join(rootDir, 'fixtures/taskflow-profile/valid.profile.json');
const res2 = runTaskflow(['open', '--dry-run', '--profile', validProfilePath]);
assert.equal(res2.ok, true);
assert.equal(res2.mode, 'dry-run');
assert.equal(res2.evidence.profile.schemaId, 'taskflow.profile.v1');
assert.equal(res2.evidence.profile.id, 'adopter-profile-v1');
assert.equal(res2.evidence.profile.name, 'Adopter Planning Repo Profile');
// 斷言 de-hardcoded 動態值是否來自 profile
assert.equal(res2.evidence.wouldDo[0].workItemId, 'TASK-ADOPTER-0001'); // 根據 taskIdPrefix 產生
assert.equal(res2.evidence.wouldDo[0].targetRepo, 'adopter-repo'); // 根據 ownerRepo 產生
assert.ok(res2.evidence.diagnostics.some((d) => d.includes('Loaded profile: Adopter Planning Repo Profile')));
assert.equal(res2.evidence.decision.delegatedTo, 'tools/task-card-opener.js');
assert.equal(res2.evidence.decision.displayHint, 'node tools/task-card-opener.js --task ${taskId} --dry-run');
// 3. 測試 open --write 被拒絕
assert.throws(() => {
    runTaskflow(['open', '--write']);
}, (err) => {
    return err.code === 'ATM_TASKFLOW_WRITE_MODE_NOT_SUPPORTED';
});
// 4. 測試 open --dry-run 有 invalid profile 被拒絕
const invalidProfilePath = path.join(rootDir, 'fixtures/taskflow-profile/invalid-missing-schema-id.profile.json');
assert.throws(() => {
    runTaskflow(['open', '--dry-run', '--profile', invalidProfilePath]);
}, (err) => {
    return err.code === 'ATM_TASKFLOW_PROFILE_INVALID_SCHEMA_ID';
});
console.log('[taskflow-dryrun:test] ok');
