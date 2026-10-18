import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-context-map-advisor-'));
const runGit = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const originalNow = Date.now;
try {

runGit('init', '--quiet');
runGit('config', 'user.email', 'atm.test@example.invalid');
runGit('config', 'user.name', 'ATM test');
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
fs.writeFileSync(path.join(repo, 'src', 'removed.ts'), 'export const removed = true;\n');
fs.writeFileSync(path.join(repo, '.gitignore'), '.atm/\n');
fs.mkdirSync(path.join(repo, '.atm', 'history', 'tasks'), { recursive: true });
fs.writeFileSync(path.join(repo, '.atm', 'history', 'tasks', 'TASK-AAO-0040.json'), JSON.stringify({
  workItemId: 'TASK-AAO-0040',
  status: 'running',
  scopePaths: ['src/context-map-advisor.ts']
}));
runGit('add', '-A');
runGit('commit', '--quiet', '-m', 'fixture');
fs.rmSync(path.join(repo, 'src', 'removed.ts'));
runGit('add', '-A');

const modulePath = path.resolve('packages/cli/src/commands/hook/context-map-advisor.ts');
const source = fs.readFileSync(modulePath, 'utf8');
const filter = source.match(/diff-filter=([A-Z]+)/)?.[1];
assert.equal(filter, 'ACMRTD', 'context-map advisor must include staged deletions');
assert.match(runGit('diff', '--cached', '--name-status', '--diff-filter=ACMRTD'), /^D\s+src\/removed\.ts$/m);

const { runContextMapAdvisor } = await import(`file://${modulePath.replace(/\\/g, '/')}`);
// Isolate deletion correctness from the advisory's existing 50ms soft budget.
// This is not a performance measurement.
Date.now = () => 0;
const report = runContextMapAdvisor(repo);
assert.ok(report, 'advisor should inspect a staged deletion');
assert.deepEqual(report.outOfScopeFiles.map((entry: { path: string }) => entry.path), ['src/removed.ts']);

console.log('[context-map-advisor-staged-deletion] ok');
} finally {
  Date.now = originalNow;
  fs.rmSync(repo, { recursive: true, force: true });
}
