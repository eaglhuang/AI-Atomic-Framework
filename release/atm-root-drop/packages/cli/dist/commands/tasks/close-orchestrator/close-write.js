import { executeTaskCloseTransaction, writeClosurePacket } from '../../framework-development.js';
import { buildTaskTransitionCommand, createClosureTransitionMetadata, writeTaskDocumentWithTransition } from '../close-helpers/task-transition-writer.js';
export async function executeCloseWrites(input) {
    const { options, actorId } = input;
    let closurePacketPath = input.closurePacketPath;
    let closurePacket = input.closurePacket;
    const closeTransitionCommand = buildTaskTransitionCommand({
        action: options.status === 'blocked' ? 'block' : options.status === 'abandoned' ? 'abandon' : 'close',
        taskId: options.taskId,
        actorId,
        status: options.status,
        fromBatchCheckpoint: options.fromBatchCheckpoint,
        batchId: input.owningBatch?.batchId ?? options.batchId,
        historicalDeliveryRefs: input.effectiveHistoricalDeliveryRefs
    });
    const closeWriteResult = await executeTaskCloseTransaction({
        cwd: options.cwd,
        taskId: options.taskId,
        taskPath: input.taskPath,
        phase: 'close',
        previousTaskContent: input.previousTaskContent,
        createdClosurePacketAbsolute: input.createdClosurePacketAbsolute,
        runWrites: () => {
            if (input.pendingClosurePacket) {
                closurePacketPath = writeClosurePacket(options.cwd, options.taskId, input.pendingClosurePacket);
                closurePacket = input.pendingClosurePacket;
                input.taskDocument.closurePacket = closurePacketPath;
            }
            const transitionPath = writeTaskDocumentWithTransition({
                cwd: options.cwd,
                taskPath: input.taskPath,
                taskId: options.taskId,
                taskDocument: input.taskDocument,
                action: options.status === 'blocked' ? 'block' : options.status === 'abandoned' ? 'abandon' : 'close',
                actorId,
                sessionId: input.activeSession?.sessionId ?? null,
                previousStatus: input.previousStatus,
                closureMetadata: options.status === 'done'
                    ? createClosureTransitionMetadata(closurePacketPath, closurePacket, input.owningBatch?.batchId ?? options.batchId, input.activeSession?.sessionId ?? null)
                    : null,
                command: closeTransitionCommand
            });
            return { transitionPath, closurePacketPath };
        }
    });
    return {
        transitionPath: closeWriteResult.transitionPath,
        closurePacketPath: closeWriteResult.closurePacketPath ?? closurePacketPath
    };
}
