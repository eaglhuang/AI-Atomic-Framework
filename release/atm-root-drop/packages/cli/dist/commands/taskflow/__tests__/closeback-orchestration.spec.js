import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyPlanningCardCloseback, resolvePlanningRosterPaths } from '../closeback-orchestration.js';
function writeText(filePath, text) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, text, 'utf8');
}
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-closeback-'));
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: repo, stdio: 'ignore' });
const planningCard = path.join(repo, 'docs/tasks/TASK-CLOSEBACK-0001.task.md');
writeText(planningCard, ['---', 'task_id: TASK-CLOSEBACK-0001', 'status: running', '---', '# TASK-CLOSEBACK-0001', ''].join('\n'));
const closeback = applyPlanningCardCloseback({
    cwd: repo,
    planningMirrorPath: planningCard,
    actorId: 'validator',
    historicalDeliveryRefs: ['abc123']
});
assert.equal(closeback?.mode, 'frontmatter-closeback');
const updatedPlanningCard = readFileSync(planningCard, 'utf8');
assert.ok(updatedPlanningCard.includes('status: done'));
assert.ok(updatedPlanningCard.includes('closedByActor: "validator"'));
const transitionIdMatch = updatedPlanningCard.match(/lastTransitionId:\s*"([^"]+)"/);
assert.ok(transitionIdMatch, 'closeback must stamp a task transition id onto the planning card');
const transitionId = transitionIdMatch?.[1] ?? '';
const transitionEventPath = path.join(repo, '.atm/history/task-events/TASK-CLOSEBACK-0001', `${transitionId}.json`);
const transitionEvent = JSON.parse(readFileSync(transitionEventPath, 'utf8'));
assert.equal(transitionEvent.action, 'close');
assert.equal(transitionEvent.toStatus, 'done');
const roster = resolvePlanningRosterPaths({
    cwd: repo,
    planningMirrorPath: planningCard,
    rosterIndexPath: 'docs/tasks/README.md'
});
assert.equal(roster.fromPath, 'docs/tasks/TASK-CLOSEBACK-0001.task.md');
assert.equal(roster.indexPath, 'docs/tasks/README.md');
console.log('ok: closeback orchestration spec passed');
