import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, relativePathFrom } from '../shared.js';
import { readTaskLedgerPolicy } from '../task-ledger.js';
import { extractFrontMatter } from './task-import-validators.js';
export function preparePlanningMirrorReconcile(input) {
    if (input.tasks.length !== 1) {
        throw new CliError('ATM_TASKS_IMPORT_RECONCILE_MIRROR_SINGLE_CARD_REQUIRED', 'tasks import --reconcile-mirror only accepts a single planning task card.', {
            exitCode: 1,
            details: { taskCount: input.tasks.length, planPath: input.planAbsolute }
        });
    }
    const taskId = input.tasks[0].workItemId;
    const taskLedger = readTaskLedgerPolicy(input.cwd);
    const ledgerPath = path.join(input.cwd, taskLedger.taskRoot, `${taskId}.json`);
    let ledger;
    try {
        ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    }
    catch {
        throw new CliError('ATM_TASKS_IMPORT_RECONCILE_MIRROR_LEDGER_UNREADABLE', `Cannot read live ledger for ${taskId}; planning mirror was not changed.`, {
            exitCode: 1,
            details: { taskId, ledgerPath }
        });
    }
    if (String(ledger.status ?? '').trim().toLowerCase() !== 'done') {
        throw new CliError('ATM_TASKS_IMPORT_RECONCILE_MIRROR_LEDGER_NOT_DONE', `Live ledger ${taskId} is not done; planning mirror was not changed.`, {
            exitCode: 1,
            details: { taskId, ledgerStatus: ledger.status ?? null }
        });
    }
    const original = readFileSync(input.planAbsolute, 'utf8');
    const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(original);
    const frontmatter = extractFrontMatter(original);
    const sourceTaskId = String(frontmatter?.data.task_id ?? frontmatter?.data.id ?? '').trim().toUpperCase();
    if (!frontmatterMatch || sourceTaskId !== taskId.toUpperCase()) {
        throw new CliError('ATM_TASKS_IMPORT_RECONCILE_MIRROR_SOURCE_INVALID', `Planning source must be a single task card for ${taskId}; planning mirror was not changed.`, {
            exitCode: 1,
            details: { taskId, planPath: input.planAbsolute, sourceTaskId: sourceTaskId || null }
        });
    }
    const currentStatus = String(frontmatter?.data.status ?? '').trim().toLowerCase();
    if (currentStatus === 'done')
        return { apply: () => null };
    if (currentStatus !== 'planned') {
        throw new CliError('ATM_TASKS_IMPORT_RECONCILE_MIRROR_STATUS_UNSAFE', `Planning card ${taskId} has status ${currentStatus || 'missing'}; refusing to overwrite it with done.`, {
            exitCode: 1,
            details: { taskId, planPath: input.planAbsolute, planningStatus: currentStatus || null }
        });
    }
    assertPlanningMirrorSourceClean(input.planAbsolute);
    const updatedFrontmatter = frontmatterMatch[1].replace(/^(\s*status\s*:\s*)planned\s*$/mi, '$1done');
    if (updatedFrontmatter === frontmatterMatch[1]) {
        throw new CliError('ATM_TASKS_IMPORT_RECONCILE_MIRROR_STATUS_UNSAFE', `Planning card ${taskId} has no writable status field; planning mirror was not changed.`, {
            exitCode: 1,
            details: { taskId, planPath: input.planAbsolute }
        });
    }
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    const updated = `${original.slice(0, frontmatterMatch.index)}---${newline}${updatedFrontmatter}${newline}---${original.slice(frontmatterMatch.index + frontmatterMatch[0].length)}`;
    return {
        apply: () => {
            writeFileSync(input.planAbsolute, updated, 'utf8');
            return relativePathFrom(input.cwd, input.planAbsolute);
        }
    };
}
function assertPlanningMirrorSourceClean(planAbsolute) {
    const repository = spawnSync('git', ['-C', path.dirname(planAbsolute), 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    if (repository.status !== 0)
        return;
    const root = repository.stdout.trim();
    const relativePath = path.relative(root, planAbsolute);
    const status = spawnSync('git', ['-C', root, 'status', '--porcelain', '--', relativePath], { encoding: 'utf8' });
    if (status.status === 0 && status.stdout.trim()) {
        throw new CliError('ATM_TASKS_IMPORT_RECONCILE_MIRROR_SOURCE_DIRTY', 'Planning mirror source has uncommitted changes; refusing to overwrite it.', {
            exitCode: 1,
            details: { planPath: planAbsolute }
        });
    }
}
