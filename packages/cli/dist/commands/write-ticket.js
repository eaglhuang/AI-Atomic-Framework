import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { acquireWriteTicket, checkWriteTicket } from '../../../core/dist/broker/write-ticket.js';
import { normalizeWritePathList } from '../../../core/dist/broker/write-scope-policy.js';
import { resolveActorId } from './actor-registry.js';
import { CliError, makeResult, message, parseJsonText } from './shared.js';
export async function runWriteTicket(argv) {
    const options = parseWriteTicketOptions(argv);
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    const actorId = resolvedActor?.actorId ?? options.actorId;
    if (!actorId) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'write-ticket requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
    }
    if (!options.taskId) {
        throw new CliError('ATM_CLI_USAGE', 'write-ticket requires --task <task-id>.', { exitCode: 2 });
    }
    if (options.action === 'acquire') {
        const task = readTaskRecord(options.cwd, options.taskId);
        const ticket = acquireWriteTicket({
            taskId: options.taskId,
            actorId,
            files: options.files.length > 0 ? options.files : readTaskAllowedFiles(task),
            intent: options.intent,
            laneSessionId: options.laneSessionId ?? readTaskLaneSessionId(task),
            ttlSeconds: options.ttlSeconds
        });
        return makeResult({
            ok: true,
            command: 'write-ticket',
            cwd: options.cwd,
            messages: [message('info', 'ATM_WRITE_TICKET_ACQUIRED', 'Write ticket acquired for task-scoped file authority.', { ticketId: ticket.ticketId })],
            evidence: { action: 'acquire', ticket, metrics: zeroMetrics({ acquisitions: 1 }) }
        });
    }
    const ticket = readTicket(options.cwd, options.ticketFile);
    const task = readTaskRecord(options.cwd, options.taskId);
    const decision = checkWriteTicket({
        ticket,
        taskId: options.taskId,
        actorId,
        files: options.files,
        operation: options.operation,
        observedPhase: options.observedPhase,
        claimActorId: readTaskClaimActorId(task),
        laneSessionId: options.laneSessionId ?? readTaskLaneSessionId(task),
        ambientActorId: resolvedActor?.source === 'legacy-env' ? resolvedActor.actorId : null,
        recoveryBypassed: options.recoveryBypassed
    });
    const code = decision.code ?? 'ATM_WRITE_TICKET_CHECK_OK';
    return makeResult({
        ok: decision.ok,
        command: 'write-ticket',
        cwd: options.cwd,
        messages: [message(decision.ok ? 'info' : 'error', code, decision.reason, {
                taskId: options.taskId,
                files: decision.requestedFiles,
                recoveryCommand: decision.recoveryCommand
            })],
        evidence: {
            action: options.action,
            decision,
            metrics: metricsForDecision(decision.classification)
        }
    });
}
function parseWriteTicketOptions(argv) {
    const options = {
        cwd: process.cwd(),
        action: '',
        taskId: '',
        actorId: null,
        files: [],
        intent: 'write',
        operation: 'write',
        observedPhase: 'pre-write',
        ticketFile: null,
        laneSessionId: null,
        ttlSeconds: null,
        recoveryBypassed: false
    };
    const files = [];
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!options.action && !arg.startsWith('--')) {
            options.action = arg;
            continue;
        }
        if (arg === '--cwd' || arg === '--repo') {
            options.cwd = path.resolve(requireValue(argv, index, arg));
            index += 1;
            continue;
        }
        if (arg === '--task') {
            options.taskId = requireValue(argv, index, arg).trim();
            index += 1;
            continue;
        }
        if (arg === '--actor') {
            options.actorId = requireValue(argv, index, arg).trim();
            index += 1;
            continue;
        }
        if (arg === '--files' || arg === '--file') {
            files.push(...requireValue(argv, index, arg).split(','));
            index += 1;
            continue;
        }
        if (arg === '--intent') {
            options.intent = requireValue(argv, index, arg).trim() || 'write';
            index += 1;
            continue;
        }
        if (arg === '--operation') {
            options.operation = parseOperation(requireValue(argv, index, arg));
            index += 1;
            continue;
        }
        if (arg === '--observed' || arg === '--phase') {
            options.observedPhase = parseObservedPhase(requireValue(argv, index, arg));
            index += 1;
            continue;
        }
        if (arg === '--ticket' || arg === '--ticket-file') {
            options.ticketFile = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--lane-session' || arg === '--lane-session-id') {
            options.laneSessionId = requireValue(argv, index, arg).trim();
            index += 1;
            continue;
        }
        if (arg === '--ttl-seconds') {
            options.ttlSeconds = Number.parseInt(requireValue(argv, index, arg), 10);
            index += 1;
            continue;
        }
        if (arg === '--recovery-bypassed') {
            options.recoveryBypassed = true;
            continue;
        }
        if (arg === '--json' || arg === '--pretty')
            continue;
        throw new CliError('ATM_CLI_USAGE', `write-ticket does not support option ${arg}`, { exitCode: 2 });
    }
    if (!['acquire', 'check', 'record-touch', 'status'].includes(options.action)) {
        throw new CliError('ATM_CLI_USAGE', 'write-ticket requires action: acquire | check | record-touch | status.', { exitCode: 2 });
    }
    return { ...options, files: normalizeWritePathList(files) };
}
function readTicket(cwd, ticketFile) {
    if (!ticketFile)
        return null;
    const absolute = path.resolve(cwd, ticketFile);
    if (!existsSync(absolute)) {
        throw new CliError('ATM_WRITE_TICKET_MISSING', `Write ticket file not found: ${ticketFile}`, { exitCode: 2, details: { ticketFile } });
    }
    return parseJsonText(readFileSync(absolute, 'utf8'));
}
function readTaskRecord(cwd, taskId) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(taskPath))
        return null;
    return parseJsonText(readFileSync(taskPath, 'utf8'));
}
function readTaskAllowedFiles(task) {
    const claim = readRecord(task?.claim);
    if (Array.isArray(claim?.files))
        return claim.files.map(String);
    if (Array.isArray(task?.scopePaths))
        return task.scopePaths.map(String);
    return [];
}
function readTaskClaimActorId(task) {
    const claim = readRecord(task?.claim);
    return typeof claim?.actorId === 'string' ? claim.actorId : null;
}
function readTaskLaneSessionId(task) {
    const claim = readRecord(task?.claim);
    const lane = readRecord(claim?.laneSession);
    return typeof lane?.laneSessionId === 'string' ? lane.laneSessionId : typeof lane?.laneId === 'string' ? lane.laneId : null;
}
function readRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function parseOperation(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'write' || normalized === 'stage' || normalized === 'commit' || normalized === 'close' || normalized === 'push')
        return normalized;
    throw new CliError('ATM_CLI_USAGE', `Unsupported write-ticket operation: ${value}`, { exitCode: 2 });
}
function parseObservedPhase(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'pre-write' || normalized === 'post-write' || normalized === 'commit' || normalized === 'close' || normalized === 'push')
        return normalized;
    throw new CliError('ATM_CLI_USAGE', `Unsupported write-ticket observed phase: ${value}`, { exitCode: 2 });
}
function requireValue(argv, index, flag) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `write-ticket requires a value for ${flag}`, { exitCode: 2 });
    }
    return value;
}
function metricsForDecision(classification) {
    return zeroMetrics({
        preWriteBlocks: classification === 'amendment-required' || classification === 'stale-ticket' || classification === 'missing-ticket' ? 1 : 0,
        postWriteDetections: classification === 'unattached-wip' ? 1 : 0,
        trueViolations: classification === 'violation' ? 1 : 0,
        falseBlocks: 0
    });
}
function zeroMetrics(overrides = {}) {
    return {
        acquisitions: 0,
        preWriteBlocks: 0,
        postWriteDetections: 0,
        scopeAmendments: 0,
        unattachedWipRecords: 0,
        trueViolations: 0,
        adapterEnforcedBlocks: 0,
        manualCaptainInterventions: 0,
        falseBlocks: 0,
        ...overrides
    };
}
