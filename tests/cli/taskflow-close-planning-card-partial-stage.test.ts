import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyPlanningCardCloseback } from '../../packages/cli/src/commands/taskflow/closeback-orchestration.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-planning-card-stage-'));
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: repo, stdio: 'ignore' });
const card = path.join(repo, 'docs/tasks/TASK-PARTIAL-STAGE.task.md');
mkdirSync(path.dirname(card), { recursive: true });
const baseline = ['---', 'task_id: TASK-PARTIAL-STAGE', 'status: running', '---', '# TASK-PARTIAL-STAGE', 'original body', ''].join('\n');
writeFileSync(card, baseline, 'utf8');
execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'seed planning card'], { cwd: repo, stdio: 'ignore' });
writeFileSync(card, ['---', 'task_id: TASK-PARTIAL-STAGE', 'status: running', 'owner_note: unrelated in-flight WIP', '---', '# TASK-PARTIAL-STAGE', 'original body', 'unrelated body WIP', ''].join('\n'), 'utf8');

const closeback = applyPlanningCardCloseback({
  cwd: repo,
  planningMirrorPath: card,
  actorId: 'validator',
  historicalDeliveryRefs: []
});
const stagedContent = (closeback as unknown as { stagedContent?: string }).stagedContent;
assert.equal(typeof stagedContent, 'string', 'closeback must provide a partial staging snapshot');
assert.ok(stagedContent?.includes('status: done'));
assert.ok(!stagedContent?.includes('unrelated in-flight WIP'));
assert.ok(!stagedContent?.includes('unrelated body WIP'));
assert.ok(readFileSync(card, 'utf8').includes('unrelated body WIP'), 'working tree WIP must remain untouched');

console.log('ok: planning-card partial-stage regression passed');
