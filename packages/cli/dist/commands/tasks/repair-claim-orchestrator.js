import path from 'node:path';
import { existsSync } from 'node:fs';
import { resolveActorId } from '../actor-registry.js';
import { CliError, makeResult, message, relativePathFrom } from '../shared.js';
import { writeTaskDocumentWithTransition } from './close-helpers/task-transition-writer.js';
import { applyClaimRepairWrite, buildRepairClaimCommand, diagnoseClaimRepairState } from './claim-repair-diagnostics.js';
import { readJsonRecord, taskPathFor } from './task-file-io-helpers.js';
function requireValue(argv, index, flag) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `tasks requires a value for ${flag}`, { exitCode: 2 });
    }
    return value;
}
export async function runTasksRepairClaim(argv) {
    const options = parseRepairClaimOptions(argv);
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks repair-claim requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    const taskPath = taskPathFor(options.cwd, options.taskId);
    if (!existsSync(taskPath)) {
        throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${options.taskId}.`, {
            exitCode: 2,
            details: { taskPath: relativePathFrom(options.cwd, taskPath), taskId: options.taskId }
        });
    }
    const taskDocument = readJsonRecord(taskPath);
    const diagnosis = diagnoseClaimRepairState(options.cwd, options.taskId, actorId);
    if (!options.write) {
        return makeResult({
            ok: true,
            command: 'tasks',
            cwd: options.cwd,
            messages: [
                message(diagnosis.blocked ? 'warn' : diagnosis.repairable ? 'info' : 'info', diagnosis.blocked
                    ? 'ATM_TASKS_REPAIR_CLAIM_BLOCKED'
                    : diagnosis.repairable
                        ? 'ATM_TASKS_REPAIR_CLAIM_REPAIRABLE'
                        : 'ATM_TASKS_REPAIR_CLAIM_CLEAN', diagnosis.blocked
                    ? `Task ${options.taskId} has a valid active claim; repair is blocked.`
                    : diagnosis.repairable
                        ? `Task ${options.taskId} has repairable claim drift.`
                        : `Task ${options.taskId} has no repairable claim drift.`, {
                    taskId: options.taskId,
                    issueCount: diagnosis.issues.length,
                    repairable: diagnosis.repairable,
                    blocked: diagnosis.blocked
                })
            ],
            evidence: {
                action: 'repair-claim-diagnose',
                taskId: options.taskId,
                actorId,
                diagnosis,
                requiredCommand: diagnosis.writeCommand
            }
        });
    }
    if (!options.reason?.trim()) {
        throw new CliError('ATM_TASK_REPAIR_CLAIM_REASON_REQUIRED', 'tasks repair-claim --write requires --reason.', {
            exitCode: 2,
            details: {
                taskId: options.taskId,
                requiredCommand: buildRepairClaimCommand({
                    taskId: options.taskId,
                    actorId,
                    write: true,
                    reason: '<why repair is required>'
                })
            }
        });
    }
    const applyResult = await applyClaimRepairWrite({
        cwd: options.cwd,
        taskId: options.taskId,
        actorId,
        reason: options.reason.trim(),
        taskDocument,
        diagnosis
    });
    const command = buildRepairClaimCommand({
        taskId: options.taskId,
        actorId,
        write: true,
        reason: options.reason.trim()
    });
    const previousStatus = typeof taskDocument.status === 'string' ? taskDocument.status : null;
    const transitionPath = writeTaskDocumentWithTransition({
        cwd: options.cwd,
        taskPath,
        taskId: options.taskId,
        taskDocument: applyResult.taskDocument,
        action: 'repair-claim',
        actorId,
        sessionId: typeof taskDocument.startedBySessionId === 'string' ? taskDocument.startedBySessionId : null,
        previousStatus,
        command
    });
    return makeResult({
        ok: true,
        command: 'tasks',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_TASKS_REPAIR_CLAIM_OK', `Repaired claim drift for ${options.taskId}.`, {
                taskId: options.taskId,
                actorId,
                repairActions: applyResult.repairActions
            })
        ],
        evidence: {
            action: 'repair-claim',
            taskId: options.taskId,
            actorId,
            diagnosis,
            before: applyResult.before,
            after: applyResult.after,
            repairActions: applyResult.repairActions,
            transitionPath,
            lifecycleOwner: diagnosis.lifecycleOwner
        }
    });
}
function parseRepairClaimOptions(argv) {
    const state = {
        cwd: process.cwd(),
        taskId: null,
        actorId: null,
        write: false,
        reason: null
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd' || arg === '--repo') {
            state.cwd = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--task') {
            state.taskId = requireValue(argv, index, '--task');
            index += 1;
            continue;
        }
        if (arg === '--actor') {
            state.actorId = requireValue(argv, index, '--actor');
            index += 1;
            continue;
        }
        if (arg === '--reason') {
            state.reason = requireValue(argv, index, '--reason');
            index += 1;
            continue;
        }
        if (arg === '--write') {
            state.write = true;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `tasks repair-claim does not support option ${arg}`, { exitCode: 2 });
    }
    if (!state.taskId) {
        throw new CliError('ATM_CLI_USAGE', 'tasks repair-claim requires --task <id>.', { exitCode: 2 });
    }
    return {
        cwd: path.resolve(state.cwd),
        taskId: state.taskId,
        actorId: state.actorId,
        write: state.write,
        reason: state.reason
    };
}
