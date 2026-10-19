import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { registerCloseCommitWindow } from '../framework-development/closure-packet-schema/implementation.js';
import { CliError, makeResult, message } from '../shared.js';
import { runTasks } from '../tasks/public-surface.js';
import { commitRepoWithTemporaryIndex } from './commit-bundle-assembly.js';
/**
 * `taskflow abandon` is the operator lane for dropping a claimed card. The
 * backend `tasks abandon` stages only the ledger and abandon event, so the
 * card markdown kept its old status and the card's earlier events and
 * evidence stayed uncommitted. This lane runs the backend transition, marks
 * the card abandoned, widens the task's close-commit window to every pending
 * record of that task, and lands them in one governed commit.
 */
export async function runTaskflowAbandon(parsed, cwd) {
    const options = parsed.options;
    const taskId = String(options.task ?? '').trim();
    const actorId = String(options.actor ?? process.env.ATM_ACTOR_ID ?? '').trim();
    const reason = String(options.reason ?? '').trim();
    if (!taskId || !actorId || !reason) {
        throw new CliError('ATM_CLI_USAGE', 'taskflow abandon requires --task <id>, --actor <id> and --reason <text>.', {
            exitCode: 2,
            details: { requiredFlags: ['--task', '--actor', '--reason'] }
        });
    }
    const cardPath = readCardPath(cwd, taskId);
    const writeCommand = `node atm.mjs taskflow abandon --task ${taskId} --actor ${actorId} --reason ${JSON.stringify(reason)} --write --json`;
    if (!options.write) {
        return makeResult({
            ok: true,
            command: 'taskflow abandon',
            cwd,
            messages: [message('info', 'ATM_TASKFLOW_ABANDON_PREVIEW', `taskflow abandon would move ${taskId} to abandoned and commit its records.`, { requiredCommand: writeCommand })],
            evidence: { taskId, actorId, mode: 'dry-run', cardPath, writeCommand }
        });
    }
    const backend = await runTasks(['abandon', '--cwd', cwd, '--task', taskId, '--actor', actorId, '--reason', reason]);
    if (!backend.ok)
        return backend;
    const windowPath = backend.evidence?.closeCommitWindowPath ?? null;
    if (cardPath && existsSync(path.join(cwd, cardPath))) {
        const card = readFileSync(path.join(cwd, cardPath), 'utf8');
        writeFileSync(path.join(cwd, cardPath), card.replace(/^status:[^\r\n]*/m, 'status: abandoned'), 'utf8');
    }
    const pendingFiles = pendingTaskRecords(cwd, taskId, cardPath);
    if (windowPath) {
        const window = JSON.parse(readFileSync(path.join(cwd, windowPath), 'utf8'));
        registerCloseCommitWindow({
            cwd,
            taskId,
            actorId,
            allowedFiles: [...(window.allowedFiles ?? []), ...pendingFiles],
            transitionId: window.transitionId ?? null,
            action: 'abandon'
        });
    }
    // Commit exactly the task's records through a temporary index, as
    // taskflow close does for its governed bundle; --auto-stage would skip
    // the untracked events and card of a card that never had a delivery.
    commitRepoWithTemporaryIndex({
        repoRoot: cwd,
        stageFiles: pendingFiles,
        args: ['commit', '-m', [`chore: abandon ${taskId}`, '', reason, '', `ATM-Actor: ${actorId}`, `ATM-Task: ${taskId}`].join('\n')],
        actorId,
        taskId
    });
    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return makeResult({
        ok: true,
        command: 'taskflow abandon',
        cwd,
        messages: [message('info', 'ATM_TASKFLOW_ABANDONED', `${taskId} is abandoned and its records are committed.`, { commitSha: commitSha })],
        evidence: { taskId, actorId, mode: 'write', cardPath, committedFiles: pendingFiles, commitSha: commitSha }
    });
}
function readCardPath(cwd, taskId) {
    const ledgerPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(ledgerPath)) {
        throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${taskId}.`, { exitCode: 2, details: { taskId } });
    }
    const planPath = JSON.parse(readFileSync(ledgerPath, 'utf8')).source?.planPath;
    if (typeof planPath !== 'string' || !planPath.trim())
        return null;
    const relative = path.relative(cwd, path.resolve(cwd, planPath)).replace(/\\/g, '/');
    // Cards in another (planning) repository are closed back through that repository.
    return relative.startsWith('../') ? null : relative;
}
function pendingTaskRecords(cwd, taskId, cardPath) {
    const pathspecs = [
        `.atm/history/tasks/${taskId}.json`,
        `.atm/history/task-events/${taskId}`,
        `.atm/history/evidence/${taskId}.*`,
        ...(cardPath ? [cardPath] : [])
    ];
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...pathspecs], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return status.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim().replace(/^"|"$/g, ''));
}
