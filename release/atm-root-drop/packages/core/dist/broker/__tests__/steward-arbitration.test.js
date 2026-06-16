import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';
import { planStewardApply, applyStewardPlan, readGitHeadCommit } from '../steward.js';
const tempFilePath = 'temp-steward-test-file.txt';
function hashText(value) {
    return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}
function setupTempFile(content) {
    writeFileSync(tempFilePath, content, 'utf8');
}
function cleanupTempFile() {
    if (existsSync(tempFilePath)) {
        rmSync(tempFilePath);
    }
}
function runTests() {
    console.log('Running steward arbitration tests...');
    const headCommit = readGitHeadCommit(process.cwd()) ?? '0000000000000000000000000000000000000000';
    // Test Case 1: Safe merge plan apply should succeed
    try {
        const originalContent = 'original content\nline2\n';
        setupTempFile(originalContent);
        const originalHash = hashText(originalContent);
        const proposal = {
            schemaId: 'atm.patchProposal.v1',
            specVersion: '0.1.0',
            migration: { strategy: 'none', fromVersion: null, notes: 'test' },
            proposalId: 'prop-1',
            taskId: 'TASK-1',
            actorId: 'agent-1',
            baseCommit: headCommit,
            fileBeforeHash: originalHash,
            targetFile: tempFilePath,
            atomRefs: [{ atomId: 'atom-1', atomCid: 'cid-1' }],
            anchors: [{ kind: 'line', hint: 'original content' }],
            intent: 'modify test file',
            patch: '@@ -1,2 +1,2 @@\n-original content\n+modified content\n line2',
            validators: [],
            rollback: 'revert'
        };
        const mergePlan = {
            schemaId: 'atm.mergePlan.v1',
            specVersion: '0.1.0',
            migration: { strategy: 'none', fromVersion: null, notes: 'test' },
            mergePlanId: 'mp-1',
            inputProposals: ['prop-1'],
            verdict: 'needs-steward',
            conflicts: [],
            applyMethod: 'patch-apply',
            requiredEvidence: []
        };
        const planRes = planStewardApply({
            cwd: process.cwd(),
            stewardId: 'test-steward',
            mergePlan,
            proposals: [proposal],
            scopeFiles: [tempFilePath]
        });
        assert.equal(planRes.ok, true, 'Plan should be ok for needs-steward');
        assert.equal(planRes.plan.issues.length, 0, 'No issues expected');
        const applyRes = applyStewardPlan({
            cwd: process.cwd(),
            stewardId: 'test-steward',
            mergePlan,
            proposals: [proposal],
            scopeFiles: [tempFilePath]
        });
        assert.equal(applyRes.ok, true, 'Apply should succeed');
        const newContent = readFileSync(tempFilePath, 'utf8');
        assert.equal(newContent.includes('modified content'), true, 'Content should be modified');
        assert.equal(newContent.includes('line2'), true, 'Unchanged line should be preserved');
        console.log('  ✅ Test Case 1: Safe merge plan apply - PASSED');
    }
    finally {
        cleanupTempFile();
    }
    // Test Case 2: Blocked/Unsafe merge plan should be rejected by planStewardApply
    try {
        setupTempFile('some content');
        const originalHash = hashText('some content');
        const proposal = {
            schemaId: 'atm.patchProposal.v1',
            specVersion: '0.1.0',
            migration: { strategy: 'none', fromVersion: null, notes: 'test' },
            proposalId: 'prop-2',
            taskId: 'TASK-2',
            actorId: 'agent-2',
            baseCommit: headCommit,
            fileBeforeHash: originalHash,
            targetFile: tempFilePath,
            atomRefs: [{ atomId: 'atom-2', atomCid: 'cid-2' }],
            anchors: [{ kind: 'line', hint: 'some content' }],
            intent: 'modify test file',
            patch: '@@ -1,1 +1,1 @@\n-some content\n+unsafe content',
            validators: [],
            rollback: 'revert'
        };
        const mergePlan = {
            schemaId: 'atm.mergePlan.v1',
            specVersion: '0.1.0',
            migration: { strategy: 'none', fromVersion: null, notes: 'test' },
            mergePlanId: 'mp-2',
            inputProposals: ['prop-2'],
            verdict: 'blocked-cid-conflict',
            conflicts: [{ kind: 'cid', detail: 'conflict detail' }],
            applyMethod: 'patch-apply',
            requiredEvidence: []
        };
        const planRes = planStewardApply({
            cwd: process.cwd(),
            stewardId: 'test-steward',
            mergePlan,
            proposals: [proposal],
            scopeFiles: [tempFilePath]
        });
        assert.equal(planRes.ok, false, 'Plan should be blocked for blocked-cid-conflict');
        assert.equal(planRes.plan.issues.some((issue) => issue.code === 'blocked-merge-plan'), true, 'Blocked merge plan issue expected');
        const applyRes = applyStewardPlan({
            cwd: process.cwd(),
            stewardId: 'test-steward',
            mergePlan,
            proposals: [proposal],
            scopeFiles: [tempFilePath]
        });
        assert.equal(applyRes.ok, false, 'Apply should be blocked');
        console.log('  ✅ Test Case 2: Unsafe merge plan rejection - PASSED');
    }
    finally {
        cleanupTempFile();
    }
    // Test Case 3: Out of scope lock proposal should be blocked
    try {
        setupTempFile('some content');
        const originalHash = hashText('some content');
        const proposal = {
            schemaId: 'atm.patchProposal.v1',
            specVersion: '0.1.0',
            migration: { strategy: 'none', fromVersion: null, notes: 'test' },
            proposalId: 'prop-3',
            taskId: 'TASK-3',
            actorId: 'agent-3',
            baseCommit: headCommit,
            fileBeforeHash: originalHash,
            targetFile: tempFilePath,
            atomRefs: [{ atomId: 'atom-3', atomCid: 'cid-3' }],
            anchors: [{ kind: 'line', hint: 'some content' }],
            intent: 'modify test file',
            patch: '@@ -1,1 +1,1 @@\n-some content\n+out of scope content',
            validators: [],
            rollback: 'revert'
        };
        const mergePlan = {
            schemaId: 'atm.mergePlan.v1',
            specVersion: '0.1.0',
            migration: { strategy: 'none', fromVersion: null, notes: 'test' },
            mergePlanId: 'mp-3',
            inputProposals: ['prop-3'],
            verdict: 'needs-steward',
            conflicts: [],
            applyMethod: 'patch-apply',
            requiredEvidence: []
        };
        // scopeFiles explicitly does NOT include tempFilePath
        const planRes = planStewardApply({
            cwd: process.cwd(),
            stewardId: 'test-steward',
            mergePlan,
            proposals: [proposal],
            scopeFiles: ['some-other-file.txt']
        });
        assert.equal(planRes.ok, false, 'Plan should be blocked due to scope mismatch');
        assert.equal(planRes.plan.issues.some((issue) => issue.code === 'scope-lock-mismatch'), true, 'Scope lock mismatch issue expected');
        console.log('  ✅ Test Case 3: Scope lock mismatch protection - PASSED');
    }
    finally {
        cleanupTempFile();
    }
    console.log('All steward arbitration tests completed successfully.');
}
runTests();
