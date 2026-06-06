import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadProfile } from '../profile-loader.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../../../../');
// 1. 測試 valid profile 讀取
const validPath = path.join(rootDir, 'fixtures/taskflow-profile/valid.profile.json');
const valid = loadProfile(validPath);
assert.equal(valid.schemaId, 'taskflow.profile.v1');
assert.equal(valid.id, 'adopter-profile-v1');
assert.equal(valid.name, 'Adopter Planning Repo Profile');
assert.equal(valid.repoLabel, 'Adopter Planning Repo');
assert.equal(valid.ownerRepo, 'adopter-repo');
assert.equal(valid.taskIdPrefix, 'TASK-ADOPTER');
assert.equal(valid.taskId.format, 'TASK-ADOPTER-NNNN');
assert.equal(valid.template.defaultMarkdown, '# ${taskId} ${title}\n\n## Goal\n${description}');
assert.equal(valid.capabilities.supportsDryRun, true);
assert.equal(valid.capabilities.supportsWrite, false);
assert.equal(valid.delegationDisplayHint, 'All task mutations must pass through the adopter specified task opener.');
assert.equal(valid.delegation.hint, 'All task ledger mutations remain delegated to the repo-profile specified task opener and compiler.');
assert.equal(valid.delegation.openerPath, 'tools/task-card-opener.js');
assert.equal(valid.delegation.writerInvocation?.describeOnly, true);
assert.equal(valid.delegation.writerInvocation?.displayHint, 'node tools/task-card-opener.js --task ${taskId} --dry-run');
// 2. 測試 missing schemaId 的 profile 讀取
const invalidPath = path.join(rootDir, 'fixtures/taskflow-profile/invalid-missing-schema-id.profile.json');
assert.throws(() => {
    loadProfile(invalidPath);
}, (err) => {
    return err.code === 'ATM_TASKFLOW_PROFILE_INVALID_SCHEMA_ID';
});
// 3. 測試 supportsWrite === true 被拒絕
const tempWriteTruePath = path.join(rootDir, 'fixtures/taskflow-profile/temp-invalid-write-true.profile.json');
const invalidWriteProfile = {
    schemaId: 'taskflow.profile.v1',
    id: 'invalid-write-profile',
    name: 'Invalid Write Profile',
    repoLabel: 'Invalid Write',
    ownerRepo: 'invalid-write',
    taskIdPrefix: 'TASK-INVALID',
    taskId: { format: 'TASK-INVALID-NNNN' },
    template: { defaultMarkdown: '# ${taskId}' },
    capabilities: {
        supportsDryRun: true,
        supportsWrite: true
    },
    delegation: {
        hint: 'Delegation hint'
    }
};
try {
    fs.writeFileSync(tempWriteTruePath, JSON.stringify(invalidWriteProfile, null, 2), 'utf8');
    assert.throws(() => {
        loadProfile(tempWriteTruePath);
    }, (err) => {
        return err.code === 'ATM_TASKFLOW_PROFILE_WRITE_NOT_ALLOWED';
    });
}
finally {
    if (fs.existsSync(tempWriteTruePath)) {
        fs.unlinkSync(tempWriteTruePath);
    }
}
// 4. 測試不存在的 profile 讀取
const missingPath = path.join(rootDir, 'fixtures/taskflow-profile/does-not-exist.json');
assert.throws(() => {
    loadProfile(missingPath);
}, (err) => {
    return err.code === 'ATM_TASKFLOW_PROFILE_NOT_FOUND';
});
console.log('[taskflow-profile-loader:test] ok');
