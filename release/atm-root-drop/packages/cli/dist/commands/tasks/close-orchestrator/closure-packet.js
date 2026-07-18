import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { CliError } from '../../shared.js';
import { computeMissingValidatorReport } from '../../evidence.js';
import { createClosurePacket, requiredValidationPassesForClosure, validateClosurePacket } from '../../framework-development.js';
import { buildHistoricalDeliveryProvenance } from '../historical-delivery.js';
import { uniqueStrings } from '../../tasks.js';
export function prepareClosurePacket(input) {
    const { options, taskDocument, actorId, activeSession, frameworkStatus, deliverableGate, taskDeclaredFiles, historicalBatchSlice } = input;
    const existingClosurePacketPath = typeof taskDocument.closurePacket === 'string'
        ? taskDocument.closurePacket
        : typeof taskDocument.closure_packet === 'string'
            ? taskDocument.closure_packet
            : null;
    if (options.status === 'done' && existingClosurePacketPath) {
        const packetPath = path.resolve(options.cwd, existingClosurePacketPath);
        if (!existsSync(packetPath)) {
            throw new CliError('ATM_TASK_CLOSE_CLOSURE_PACKET_MISSING', `Task ${options.taskId} references a missing closure packet.`, {
                details: { taskId: options.taskId, closurePacketPath: existingClosurePacketPath }
            });
        }
        const packet = JSON.parse(readFileSync(packetPath, 'utf8'));
        const validation = validateClosurePacket(packet);
        if (!validation.ok) {
            const missingReport = computeMissingValidatorReport(options.cwd, options.taskId, actorId);
            throw new CliError('ATM_TASK_CLOSE_CLOSURE_PACKET_INVALID', `Task ${options.taskId} closure packet is invalid.`, {
                details: {
                    taskId: options.taskId,
                    closurePacketPath: existingClosurePacketPath,
                    missing: validation.missing,
                    invalidFormat: validation.invalidFormat,
                    tldr: missingReport.tldr,
                    missingValidationPasses: missingReport.missingValidationPasses,
                    blockingFindings: missingReport.blockingFindings
                }
            });
        }
        return {
            existingClosurePacketPath,
            closurePacketPath: existingClosurePacketPath,
            closurePacket: packet,
            pendingClosurePacket: null,
            createdClosurePacketAbsolute: null
        };
    }
    if (options.status !== 'done' || frameworkStatus?.repoRole !== 'framework') {
        return {
            existingClosurePacketPath,
            closurePacketPath: null,
            closurePacket: null,
            pendingClosurePacket: null,
            createdClosurePacketAbsolute: null
        };
    }
    const closePacketChangedFiles = deliverableGate?.deliverableFiles.length ? deliverableGate.deliverableFiles : taskDeclaredFiles;
    const pendingClosurePacket = createClosurePacket({
        cwd: options.cwd,
        taskId: options.taskId,
        actorId,
        sessionId: activeSession?.sessionId ?? null,
        evidencePath: `.atm/history/evidence/${options.taskId}.json`,
        requiredGates: historicalBatchSlice?.okToCloseTask === true
            ? uniqueStrings([
                ...historicalBatchSlice.taskSpecificValidationPasses,
                ...historicalBatchSlice.batchWideValidationPasses
            ])
            : requiredValidationPassesForClosure(frameworkStatus.requiredGates, closePacketChangedFiles),
        changedFiles: closePacketChangedFiles,
        frameworkStatus,
        validationPasses: historicalBatchSlice?.okToCloseTask === true
            ? uniqueStrings([
                ...historicalBatchSlice.taskSpecificValidationPasses,
                ...historicalBatchSlice.batchWideValidationPasses,
                ...historicalBatchSlice.advisoryValidationPasses
            ])
            : undefined,
        evidenceFreshness: historicalBatchSlice?.okToCloseTask === true ? 'fresh' : undefined,
        historicalDeliveryProvenance: buildHistoricalDeliveryProvenance(deliverableGate?.historicalDeliveries[0] ?? null, options.reason)
    });
    const validation = validateClosurePacket(pendingClosurePacket);
    if (!validation.ok) {
        const missingReport = computeMissingValidatorReport(options.cwd, options.taskId, actorId);
        throw new CliError('ATM_TASK_CLOSE_CLOSURE_PACKET_INVALID', `Task ${options.taskId} closure packet contract is incomplete.`, {
            details: {
                taskId: options.taskId,
                missing: validation.missing,
                invalidFormat: validation.invalidFormat,
                tldr: missingReport.tldr,
                missingValidationPasses: missingReport.missingValidationPasses,
                blockingFindings: missingReport.blockingFindings
            }
        });
    }
    return {
        existingClosurePacketPath,
        closurePacketPath: null,
        closurePacket: pendingClosurePacket,
        pendingClosurePacket,
        createdClosurePacketAbsolute: path.join(options.cwd, '.atm', 'history', 'evidence', `${options.taskId}.closure-packet.json`)
    };
}
