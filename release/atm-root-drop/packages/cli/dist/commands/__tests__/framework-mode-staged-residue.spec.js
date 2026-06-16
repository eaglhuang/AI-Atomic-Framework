import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runHook } from '../hook.js';
import { runFrameworkTempClaim, runFrameworkTempRelease } from '../framework-development.js';
function initGitRepo(cwd) {
    execFileSync('git', ['init', '-q'], { cwd });
    execFileSync('git', ['config', '--local', 'user.name', 'test-actor'], { cwd });
    execFileSync('git', ['config', '--local', 'user.email', 'test-actor@example.local'], { cwd });
}
async function testSessionResidueWarnings() {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-residue-test-'));
    try {
        initGitRepo(tempRoot);
        // 建立一個初始檔案並 stage 它
        const stagedFile = 'packages/core/src/index.ts';
        mkdirSync(path.join(tempRoot, 'packages/core/src'), { recursive: true });
        writeFileSync(path.join(tempRoot, stagedFile), 'export const main = true;\n', 'utf8');
        execFileSync('git', ['add', stagedFile], { cwd: tempRoot });
        // 1. Session Resume (Claim) 時檢測到 staged residue 警告
        // claim 指定 scope 為 packages/cli/src/atm.ts，因此 stagedFile 是 scope 之外的 staged 殘留
        const claimResult = await runFrameworkTempClaim(tempRoot, 'test-agent', ['packages/cli/src/atm.ts'], 'testing claim residue warning');
        assert.equal(claimResult.ok, true);
        const hasResidueWarning = claimResult.messages.some((msg) => msg.code === 'ATM_FRAMEWORK_STAGED_RESIDUE_DETECTED');
        assert.ok(hasResidueWarning, 'claim should emit ATM_FRAMEWORK_STAGED_RESIDUE_DETECTED warning');
        // 2. Session End (Release) 時檢測到 staged residue 警告
        // 此時 staged 檔案依然存在於 index，執行 release
        const releaseResult = await runFrameworkTempRelease(tempRoot, 'test-agent');
        assert.equal(releaseResult.ok, true);
        const hasReleaseWarning = releaseResult.messages.some((msg) => msg.code === 'ATM_FRAMEWORK_STAGED_RESIDUE_AT_RELEASE');
        assert.ok(hasReleaseWarning, 'release should emit ATM_FRAMEWORK_STAGED_RESIDUE_AT_RELEASE warning');
    }
    finally {
        rmSync(tempRoot, { recursive: true, force: true });
    }
}
async function testCrossFileConsistency() {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-consistency-test-'));
    try {
        initGitRepo(tempRoot);
        // 建立初始 commit 以作為基準
        const bFile = 'packages/core/src/b.ts';
        const aFile = 'packages/core/src/a.ts';
        mkdirSync(path.join(tempRoot, 'packages/core/src'), { recursive: true });
        // 初始化 b.ts 宣告 foo
        writeFileSync(path.join(tempRoot, bFile), 'export const foo = 1;\n', 'utf8');
        writeFileSync(path.join(tempRoot, aFile), 'import { foo } from "./b";\nconsole.log(foo);\n', 'utf8');
        execFileSync('git', ['add', bFile, aFile], { cwd: tempRoot });
        execFileSync('git', ['commit', '-m', 'initial'], { cwd: tempRoot });
        // 修改 b.ts 但「不 stage」它（即 unstaged changes 影響 foo 符號）
        writeFileSync(path.join(tempRoot, bFile), 'export const foo = 2;\nexport const bar = 3;\n', 'utf8');
        // 修改 a.ts 並 stage 它
        writeFileSync(path.join(tempRoot, aFile), 'import { foo } from "./b";\nconsole.log(foo);\n// modified a\n', 'utf8');
        execFileSync('git', ['add', aFile], { cwd: tempRoot });
        // 1. 執行 pre-commit hook，應因為 b.ts 修改了 foo 且未 staged 被拒絕
        const hookResult1 = await runHook(['pre-commit', '--cwd', tempRoot]);
        assert.equal(hookResult1.ok, false, 'should block commit due to cross-file consistency failure');
        const hasConsistencyError = hookResult1.evidence.blockingFindings.some((finding) => finding.code === 'ATM_PRE_COMMIT_CROSS_FILE_INCONSISTENCY');
        assert.ok(hasConsistencyError, 'should report ATM_PRE_COMMIT_CROSS_FILE_INCONSISTENCY error');
        // 2. 將 b.ts 也 stage 進去，此時無 consistency 錯誤，應該通過
        execFileSync('git', ['add', bFile], { cwd: tempRoot });
        const hookResult2 = await runHook(['pre-commit', '--cwd', tempRoot]);
        // 因為這是一個乾淨的假 repo，可能還會觸及 framework-development 其他 blockers（例如沒有 active claim 等）
        // 但我們至少應確認 ATM_PRE_COMMIT_CROSS_FILE_INCONSISTENCY 已經消失
        const hasConsistencyError2 = hookResult2.evidence.blockingFindings.some((finding) => finding.code === 'ATM_PRE_COMMIT_CROSS_FILE_INCONSISTENCY');
        assert.ok(!hasConsistencyError2, 'should NOT report ATM_PRE_COMMIT_CROSS_FILE_INCONSISTENCY when both are staged');
    }
    finally {
        rmSync(tempRoot, { recursive: true, force: true });
    }
}
async function main() {
    await testSessionResidueWarnings();
    await testCrossFileConsistency();
    console.log('[framework-mode-staged-residue] all assertions passed.');
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
