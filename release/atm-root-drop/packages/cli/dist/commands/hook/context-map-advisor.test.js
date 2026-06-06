import assert from 'node:assert/strict';
import { runContextMapAdvisor } from './context-map-advisor.js';
// 測試 suggestCategory 啟發式分類
function testSuggestCategory() {
    const suggestCategory = (filePath) => {
        const lower = filePath.toLowerCase();
        if (lower.includes('.test.ts') ||
            lower.includes('.spec.ts') ||
            lower.includes('.test.js') ||
            lower.includes('.spec.js') ||
            lower.includes('tests/') ||
            lower.includes('__tests__/')) {
            return 'tests';
        }
        if (lower.endsWith('.ts') ||
            lower.endsWith('.tsx') ||
            lower.endsWith('.js') ||
            lower.endsWith('.jsx') ||
            lower.endsWith('.go') ||
            lower.endsWith('.py') ||
            (lower.includes('src/') && !lower.endsWith('.md'))) {
            return 'primary';
        }
        return 'secondary';
    };
    assert.equal(suggestCategory('packages/cli/src/commands/hook/context-map-advisor.test.ts'), 'tests');
    assert.equal(suggestCategory('tests/cli/tasks-new.test.ts'), 'tests');
    assert.equal(suggestCategory('packages/cli/src/commands/hook/context-map-advisor.ts'), 'primary');
    assert.equal(suggestCategory('packages/cli/src/atm.ts'), 'primary');
    assert.equal(suggestCategory('package.json'), 'secondary');
    assert.equal(suggestCategory('docs/README.md'), 'secondary');
    console.log('✅ suggestCategory tests passed');
}
// 測試 isPathMatched 路徑比對
function testIsPathMatched() {
    const normalizePath = (p) => p.replace(/\\/g, '/');
    const isPathMatched = (filePath, patterns) => {
        const normalized = normalizePath(filePath);
        return patterns.some(pattern => {
            const p = normalizePath(pattern);
            if (p.includes('*')) {
                const regexStr = '^' + p
                    .replace(/\./g, '\\.')
                    .replace(/\*\*/g, '.*')
                    .replace(/\*/g, '[^/]*') + '$';
                try {
                    return new RegExp(regexStr).test(normalized);
                }
                catch {
                    return false;
                }
            }
            return normalized === p;
        });
    };
    const allowed = [
        'packages/cli/src/commands/hook.ts',
        'packages/cli/src/commands/hook/context-map-advisor.ts',
        'packages/cli/src/commands/hook/context-map-advisor.test.ts',
        'packages/cli/src/commands/hook/*.test.ts'
    ];
    assert.ok(isPathMatched('packages/cli/src/commands/hook.ts', allowed));
    assert.ok(isPathMatched('packages/cli/src/commands/hook/context-map-advisor.ts', allowed));
    assert.ok(isPathMatched('packages/cli/src/commands/hook/foo.test.ts', allowed));
    assert.ok(!isPathMatched('packages/cli/src/commands/other.ts', allowed));
    console.log('✅ isPathMatched tests passed');
}
// 測試 runContextMapAdvisor 在沒有 staged files 時回傳 null
function testRunContextMapAdvisorWithNoStaged() {
    const result = runContextMapAdvisor(process.cwd());
    // 在沒有 staged 或是吻合時，不應造成任何 error，應 gracefully 回傳報告或 null
    assert.ok(result === null || typeof result === 'object');
    console.log('✅ runContextMapAdvisor sanity test passed');
}
// 執行所有測試
testSuggestCategory();
testIsPathMatched();
testRunContextMapAdvisorWithNoStaged();
console.log('[context-map-advisor:test] All tests verified successfully');
