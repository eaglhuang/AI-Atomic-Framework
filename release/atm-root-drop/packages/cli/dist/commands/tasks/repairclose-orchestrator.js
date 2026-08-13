import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { assertRunnerFreshForWriteAction, repairClosurePacketForTask } from '../framework-development.js';
import { assertEmergencyApproval } from '../emergency/gate.js';
import { resolveActorId } from '../actor-registry.js';
import { CliError, makeResult, message } from '../shared.js';
import { recordStaleRunnerOverride } from './close-governance.js';
import { readJsonRecord, taskPathFor } from './task-file-io-helpers.js';
import { parseAllowStaleRunnerFlag } from './task-option-parsers.js';
import { writeTaskDocumentWithTransition } from './close-helpers/task-transition-writer.js';
import { issueRepairClosureAdmissionTicket } from '../git-governance/work-admission-check.js';
export async function runTasksRepairClosure(argv) {
    const options = parseRepairClosureOptions(argv);
    // ATM-GOV-0356: resolve the actor the way every other governed surface does,
    // including the ATM_ACTOR_ID fallback. The previous form only resolved when
    // --actor was passed explicitly, so an actorless repair silently skipped the
    // bridging work-admission ticket below and staged changes that no governed
    // commit could ever accept.
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    let emergencyUse = null;
    if (!options.dryRun) {
        const staleGate = assertRunnerFreshForWriteAction({
            cwd: options.cwd,
            action: 'tasks-repair-closure-write',
            allowStaleRunner: options.allowStaleRunner
        });
        emergencyUse = assertEmergencyApproval({
            cwd: options.cwd,
            surface: 'tasks repair-closure',
            permission: 'backend.tasks.repairClosure',
            taskId: options.taskId,
            actorId: resolvedActor?.actorId ?? null,
            emergencyApproval: options.emergencyApproval,
            flags: [
                ...(options.amend ? ['--amend'] : []),
                ...(options.allowStaleRunner ? ['--allow-stale-runner'] : [])
            ],
            reason: 'Direct closure packet repair backend mutation.',
            command: `node atm.mjs tasks repair-closure --task ${options.taskId} --json`
        });
        if (options.allowStaleRunner && staleGate.warning) {
            await recordStaleRunnerOverride({
                cwd: options.cwd,
                taskId: options.taskId,
                actorId: resolvedActor?.actorId ?? null,
                action: 'tasks-repair-closure-write',
                command: `node atm.mjs tasks repair-closure --task ${options.taskId} --allow-stale-runner --json`
            });
        }
    }
    const result = repairClosurePacketForTask({
        cwd: options.cwd,
        taskId: options.taskId,
        actorId: resolvedActor?.actorId ?? null,
        dryRun: options.dryRun,
        amend: options.amend,
        scopeTaskId: options.scopeTaskId
    });
    let repairAuthority = null;
    if (!options.dryRun) {
        repairAuthority = writeRepairClosureTransition({
            cwd: options.cwd,
            taskId: options.taskId,
            actorId: resolvedActor?.actorId ?? null,
            command: `node atm.mjs tasks repair-closure --task ${options.taskId}${resolvedActor?.actorId ? ` --actor ${resolvedActor.actorId}` : ''} --json`
        });
    }
    const stagedOnly = !result.amended;
    return makeResult({
        ok: true,
        command: 'tasks',
        cwd: options.cwd,
        messages: [
            message('info', options.dryRun ? 'ATM_TASKS_REPAIR_CLOSURE_DRY_RUN' : 'ATM_TASKS_REPAIR_CLOSURE_OK', options.dryRun
                ? `Dry-run: closure packet ${options.taskId} can be repaired without rewriting HEAD.`
                : stagedOnly
                    ? `Repaired and staged closure packet follow-up changes for ${options.taskId}. HEAD was not rewritten.`
                    : `Repaired closure packet for ${options.taskId}.`, {
                taskId: options.taskId,
                packetPath: result.packetPath,
                targetCommit: result.targetCommit,
                governedTreeSha: result.governedTreeSha,
                amended: result.amended,
                previousHead: result.previousHead,
                repairedHead: result.repairedHead,
                upstreamStatus: result.upstreamStatus,
                nextActionCommand: result.nextActionCommand,
                remediation: result.remediation,
                workAdmissionTicketId: repairAuthority?.workAdmissionTicket?.ticketId ?? null,
                workAdmissionTicketDigest: repairAuthority?.workAdmissionTicket?.ticketDigest ?? null,
                workAdmissionTicketExpiresAt: repairAuthority?.workAdmissionTicket?.expiresAt ?? null
            })
        ],
        evidence: {
            result,
            emergencyUse,
            transitionPath: repairAuthority?.transitionPath ?? null,
            workAdmissionTicket: repairAuthority?.workAdmissionTicket ?? null,
            nextAction: !options.dryRun && stagedOnly ? {
                kind: 'governed-commit-required',
                command: result.nextActionCommand,
                reason: result.remediation,
                message: result.commitMessage
            } : null,
            suggestedVerification: 'node atm.mjs hook pre-push --base origin/main --head HEAD --json'
        }
    });
}
function writeRepairClosureTransition(input) {
    const taskPath = taskPathFor(input.cwd, input.taskId);
    if (!existsSync(taskPath))
        return null;
    const taskDocument = readJsonRecord(taskPath);
    // The ticket is the only bridge from a staged closure repair to its follow-up
    // governed commit. Staging without it leaves changes that fail closed at
    // commit time with ATM_WRITE_TICKET_MISSING and no route forward, so an
    // unresolvable actor must stop the repair rather than silently skip the bridge.
    if (!input.actorId) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks repair-closure requires --actor or ATM_ACTOR_ID: without an actor it cannot issue the work-admission ticket that admits the follow-up governed commit.', {
            exitCode: 2,
            details: {
                taskId: input.taskId,
                requiredCommand: `node atm.mjs tasks repair-closure --task ${input.taskId} --actor <id> --json`
            }
        });
    }
    taskDocument.workAdmissionTicket = issueRepairClosureAdmissionTicket({
        cwd: input.cwd,
        taskId: input.taskId,
        actorId: input.actorId
    });
    const previousStatus = typeof taskDocument.status === 'string' ? taskDocument.status : null;
    const transitionPath = writeTaskDocumentWithTransition({
        cwd: input.cwd,
        taskPath,
        taskId: input.taskId,
        action: 'repair-closure',
        sessionId: typeof taskDocument.closedBySessionId === 'string' ? taskDocument.closedBySessionId : null,
        taskDocument,
        actorId: input.actorId,
        previousStatus,
        command: input.command
    });
    execFileSync('git', ['-C', input.cwd, 'add', '--', taskPath, transitionPath], { stdio: 'ignore' });
    return {
        transitionPath,
        workAdmissionTicket: isRepairTicket(taskDocument.workAdmissionTicket)
            ? taskDocument.workAdmissionTicket
            : null
    };
}
function isRepairTicket(value) {
    return Boolean(value && typeof value === 'object'
        && value.schemaId === 'atm.workAdmissionTicket.v1');
}
function parseRepairClosureOptions(argv) {
    const state = {
        cwd: process.cwd(),
        taskId: null,
        actorId: null,
        scopeTaskId: null,
        dryRun: false,
        amend: false,
        emergencyApproval: null,
        allowStaleRunner: parseAllowStaleRunnerFlag(argv)
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
        if (arg === '--emergency-approval') {
            state.emergencyApproval = requireValue(argv, index, '--emergency-approval');
            index += 1;
            continue;
        }
        if (arg === '--scope') {
            state.scopeTaskId = requireValue(argv, index, '--scope');
            index += 1;
            continue;
        }
        if (arg === '--dry-run') {
            state.dryRun = true;
            continue;
        }
        if (arg === '--amend') {
            state.amend = true;
            continue;
        }
        if (arg === '--no-amend') {
            state.amend = false;
            continue;
        }
        if (arg === '--json' || arg === '--pretty' || arg === '--allow-stale-runner') {
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `tasks repair-closure does not support option ${arg}`, { exitCode: 2 });
    }
    if (!state.taskId) {
        throw new CliError('ATM_CLI_USAGE', 'tasks repair-closure requires --task <id>.', { exitCode: 2 });
    }
    return {
        cwd: path.resolve(state.cwd),
        taskId: state.taskId,
        actorId: state.actorId,
        scopeTaskId: state.scopeTaskId,
        dryRun: state.dryRun,
        allowStaleRunner: state.allowStaleRunner,
        emergencyApproval: state.emergencyApproval,
        amend: state.amend
    };
}
function requireValue(argv, index, flag) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `tasks requires a value for ${flag}`, { exitCode: 2 });
    }
    return value;
}
