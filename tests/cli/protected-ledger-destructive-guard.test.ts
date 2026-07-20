import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveTaskScopedCommitBundle } from '../../packages/cli/src/commands/git-governance.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-protected-ledger-guard-'));
const taskId = 'TASK-PROTECTED-LEDGER-0001';

function git(args: readonly string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

mkdirSync(path.join(repo, '.atm/history/tasks'), { recursive: true });
mkdirSync(path.join(repo, '.atm/history/task-events', taskId), { recursive: true });
mkdirSync(path.join(repo, 'src'), { recursive: true });
writeFileSync(path.join(repo, 'src/app.ts'), 'export const app = true;\n');
writeFileSync(path.join(repo, '.atm/history/tasks', `${taskId}.json`), '{}\n');
writeFileSync(path.join(repo, '.atm/history/task-events', taskId, 'event.json'), '{}\n');

git(['init']);
git(['config', 'user.name', 'ATM Test']);
git(['config', 'user.email', 'atm-test@example.invalid']);
git(['add', '.']);
git(['commit', '-m', 'baseline']);

writeFileSync(path.join(repo, 'src/app.ts'), 'export const app = false;\n');
git(['rm', '-q', path.join('.atm/history/task-events', taskId, 'event.json')]);

const report = resolveTaskScopedCommitBundle({
  cwd: repo,
  taskId,
  taskDocument: { taskDirectionLock: { allowedFiles: ['src/app.ts'] } },
  apply: false,
  autoStage: false,
  deferForeignStaged: false,
  message: 'test',
  actorId: 'captain',
  trailers: []
});

assert.equal(existsSync(path.join(repo, '.atm/history/task-events', taskId, 'event.json')), false);
assert.equal(report.ok, false);
assert.match(JSON.stringify(report), /history|ledger|protected|task-events/i);

console.log('[protected-ledger-destructive-guard] ok');
