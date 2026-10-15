import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTaskflowCommitBundle } from '../commit-bundle-assembly.ts';

const temp = mkdtempSync(path.join(os.tmpdir(), 'atm-local-planning-'));
function init(repo: string) {
    mkdirSync(repo, { recursive: true });
    for (const args of [['init'], ['config', 'user.name', 'Fixture'],
        ['config', 'user.email', 'fixture@example.invalid'], ['commit', '--allow-empty', '-m', 'base']]) {
        execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    }
}
function write(repo: string, file: string, content: string) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), content);
}
function bundle(label: string, external: boolean, allowIndex: boolean) {
    const target = path.join(temp, label), planning = external ? path.join(temp, label + '-plan') : target;
    init(target);
    if (external) init(planning);
    const taskId = 'TASK-LOCAL-0001', plan = 'docs/tasks/TASK-LOCAL-0001.task.md';
    write(planning, plan, '# Task\n');
    write(target, 'src/app.ts', 'export const value = 1;\n');
    write(target, 'docs/tasks/index.json', '{}\n');
    const deliverables = ['src/app.ts', 'docs/tasks/index.json'];
    write(target, `.atm/history/tasks/${taskId}.json`, JSON.stringify({
        workItemId: taskId, deliverables, scopePaths: deliverables,
        taskDirectionLock: { allowedFiles: allowIndex ? deliverables : ['src/app.ts'] },
        source: { planPath: path.join(planning, plan) },
    }));
    return buildTaskflowCommitBundle({ cwd: target, taskId, actorId: 'fixture', commitMode: 'dry-run',
        planningMirrorPath: path.join(planning, plan), rosterIndexPath: null, planningAuthorityDeliveryOk: false });
}
assert.equal(bundle('same', false, true).failClosed, false, 'same-repo declared task index and source must compose');
assert.equal(bundle('foreign', true, true).failClosed, true, 'cross-repo mixed planning and target declarations stay blocked');
assert.equal(bundle('outside', false, false).failClosed, true, 'same repo does not grant an undeclared path');
console.log('ok: same-repo planning bundle boundary');
