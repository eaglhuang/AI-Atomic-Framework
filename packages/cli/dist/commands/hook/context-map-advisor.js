import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
export function runContextMapAdvisor(cwd) {
    const startTime = Date.now();
    const root = path.resolve(cwd);
    try {
        // 1. 取得 staged 檔案
        const stagedFiles = readStagedFiles(root);
        if (stagedFiles.length === 0) {
            return null;
        }
        // 2. 找 current task
        const taskId = findCurrentTaskId(root);
        if (!taskId) {
            return null;
        }
        // 3. 讀取 task json
        const taskJsonPath = path.join(root, '.atm', 'history', 'tasks', `${taskId}.json`);
        if (!fs.existsSync(taskJsonPath)) {
            return null;
        }
        // 隨時檢查效能，如果 >50ms 則直接 skip
        if (Date.now() - startTime > 50)
            return null;
        const taskContent = fs.readFileSync(taskJsonPath, 'utf8');
        const task = JSON.parse(taskContent);
        // 隨時檢查效能
        if (Date.now() - startTime > 50)
            return null;
        // 收集所有允許的 path
        const allowedPatterns = new Set();
        // 收集 scopePaths
        if (Array.isArray(task.scopePaths)) {
            for (const p of task.scopePaths) {
                if (typeof p === 'string')
                    allowedPatterns.add(p);
            }
        }
        // 收集 contextMap 中的 primary, secondary, tests
        if (task.contextMap && typeof task.contextMap === 'object') {
            const categories = ['primary', 'secondary', 'tests'];
            for (const cat of categories) {
                const list = task.contextMap[cat];
                if (Array.isArray(list)) {
                    for (const item of list) {
                        if (item && typeof item === 'object' && typeof item.path === 'string') {
                            allowedPatterns.add(item.path);
                        }
                    }
                }
            }
        }
        // 將 allowedPatterns 轉為 array
        const allowedList = Array.from(allowedPatterns);
        // 比對 staged files
        const outOfScope = [];
        for (const file of stagedFiles) {
            if (Date.now() - startTime > 50)
                return null; // 效能守門
            // 排除 .atm/ 目錄下的變動（通常是 evidence, task json，不屬於 scope 警告範圍）
            if (file.startsWith('.atm/') || file === 'package.json' || file === 'package-lock.json') {
                continue;
            }
            if (!isPathMatched(file, allowedList)) {
                outOfScope.push({
                    path: file,
                    suggestedCategory: suggestCategory(file)
                });
            }
        }
        if (outOfScope.length === 0) {
            return null;
        }
        const elapsed = Date.now() - startTime;
        if (elapsed > 50) {
            // 效能目標超時直接 skip
            return null;
        }
        // 輸出警告 (exit 0, stdout/stderr advisory only)
        printAdvisoryWarning(taskId, outOfScope);
        return {
            taskId,
            outOfScopeFiles: outOfScope
        };
    }
    catch (err) {
        // 絕對不擋 commit，所以任何 exception 都 silent return null
        return null;
    }
}
function readStagedFiles(cwd) {
    try {
        const stdout = execSync('git diff --cached --name-only --diff-filter=ACMRT', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        return stdout
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(normalizePath);
    }
    catch {
        return [];
    }
}
function findCurrentTaskId(root) {
    // 1. 嘗試從 .git/COMMIT_EDITMSG 解析
    try {
        const commitEditMsgPath = path.join(root, '.git', 'COMMIT_EDITMSG');
        if (fs.existsSync(commitEditMsgPath)) {
            const msg = fs.readFileSync(commitEditMsgPath, 'utf8');
            const match = msg.match(/(TASK-AAO-\d+)/i);
            if (match) {
                return match[1].toUpperCase();
            }
        }
    }
    catch {
        // ignore
    }
    // 2. 查 ledger 找唯一 in_progress 或是 running 的卡
    try {
        const tasksDir = path.join(root, '.atm', 'history', 'tasks');
        if (fs.existsSync(tasksDir)) {
            const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.json'));
            const activeTasks = [];
            for (const file of files) {
                const filePath = path.join(tasksDir, file);
                const content = fs.readFileSync(filePath, 'utf8');
                const task = JSON.parse(content);
                if (task.status === 'in_progress' || task.status === 'running') {
                    if (task.workItemId) {
                        activeTasks.push(task.workItemId);
                    }
                }
            }
            if (activeTasks.length === 1) {
                return activeTasks[0];
            }
        }
    }
    catch {
        // ignore
    }
    return null;
}
function normalizePath(p) {
    return p.replace(/\\/g, '/');
}
function isPathMatched(filePath, patterns) {
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
}
function suggestCategory(filePath) {
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
}
function printAdvisoryWarning(taskId, outOfScope) {
    const lines = [];
    lines.push('');
    lines.push(`⚠️  \x1b[33m[ATM Advisory]\x1b[0m Staged files contain out-of-scope changes for current task \x1b[36m${taskId}\x1b[0m:`);
    // 按建議分類分群
    const byCategory = { primary: [], secondary: [], tests: [] };
    for (const item of outOfScope) {
        byCategory[item.suggestedCategory].push(item.path);
    }
    for (const cat of ['primary', 'secondary', 'tests']) {
        const files = byCategory[cat];
        if (files.length > 0) {
            lines.push(`  \x1b[1mSuggested Category: ${cat}\x1b[0m`);
            for (const file of files) {
                lines.push(`    - ${file}`);
            }
        }
    }
    lines.push(`\x1b[90mThis warning is advisory only (exit 0) and will not block your commit.\x1b[0m`);
    lines.push('');
    process.stderr.write(lines.join('\n'));
}
