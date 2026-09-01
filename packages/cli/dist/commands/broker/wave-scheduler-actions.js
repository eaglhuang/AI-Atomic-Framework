import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message } from '../shared.js';
import { createEmptyWaveBrokerSchedulerDocument, enqueueWaveBrokerTicket, planWaveBrokerBatch } from '../../../../core/dist/broker/wave-broker-scheduler.js';
function readScheduler(pathName) {
    if (!existsSync(pathName))
        return createEmptyWaveBrokerSchedulerDocument();
    const parsed = JSON.parse(readFileSync(pathName, 'utf8'));
    if (parsed?.schemaId !== 'atm.waveBrokerScheduler.v1') {
        throw new CliError('ATM_BROKER_SCHEDULER_INVALID', `Wave broker scheduler document is invalid: ${pathName}`, { exitCode: 2 });
    }
    return parsed;
}
function writeScheduler(pathName, document) {
    mkdirSync(path.dirname(pathName), { recursive: true });
    writeFileSync(pathName, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}
export function handleBrokerWaveScheduler(options, context) {
    if (options.action !== 'schedule')
        return null;
    const action = options.scheduleAction;
    if (action === 'status') {
        const document = readScheduler(context.waveSchedulerPath);
        return makeResult({
            ok: true,
            command: 'broker',
            cwd: options.cwd,
            messages: [message('info', 'ATM_BROKER_SCHEDULER_STATUS', `Wave broker scheduler has ${document.tickets.length} ticket(s).`)],
            evidence: { schedulerPath: '.atm/runtime/wave-broker-scheduler.json', document }
        });
    }
    if (action === 'enqueue') {
        if (!options.task || !options.waveId || !options.surfaceKind || !options.surfaceFamily || !options.payloadDigest) {
            throw new CliError('ATM_CLI_USAGE', 'broker schedule enqueue requires --task, --wave, --surface-kind, --surface-family, and --payload-digest.', { exitCode: 2 });
        }
        const current = readScheduler(context.waveSchedulerPath);
        const result = enqueueWaveBrokerTicket(current, {
            waveId: options.waveId,
            taskId: options.task,
            surfaceKind: options.surfaceKind,
            surfaceFamily: options.surfaceFamily,
            payloadDigest: options.payloadDigest
        });
        if (!result.replayed)
            writeScheduler(context.waveSchedulerPath, result.document);
        return makeResult({
            ok: true,
            command: 'broker',
            cwd: options.cwd,
            messages: [message('info', result.replayed ? 'ATM_BROKER_SCHEDULER_TICKET_REPLAYED' : 'ATM_BROKER_SCHEDULER_TICKET_ENQUEUED', `Wave broker ticket ${result.ticket.ticketId} is ${result.ticket.state}.`)],
            evidence: { schedulerPath: '.atm/runtime/wave-broker-scheduler.json', ticket: result.ticket, replayed: result.replayed }
        });
    }
    if (action === 'plan') {
        const document = readScheduler(context.waveSchedulerPath);
        const decision = planWaveBrokerBatch({
            document,
            waveId: options.waveId,
            surfaceKind: options.surfaceKind,
            surfaceFamily: options.surfaceFamily,
            expectedTaskIds: options.expectedTasks,
            collectionTimeoutMs: options.collectionTimeoutMs
        });
        return makeResult({
            ok: true,
            command: 'broker',
            cwd: options.cwd,
            messages: [message('info', 'ATM_BROKER_SCHEDULER_PLAN', `Wave broker scheduler verdict: ${decision.verdict}.`)],
            evidence: { schedulerPath: '.atm/runtime/wave-broker-scheduler.json', decision }
        });
    }
    throw new CliError('ATM_CLI_USAGE', 'broker schedule supports enqueue, plan, and status.', { exitCode: 2 });
}
