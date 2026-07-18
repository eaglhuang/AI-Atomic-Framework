import {
  executeTaskCloseTransaction,
  type ClosurePacket,
  writeClosurePacket
} from '../../framework-development.ts';
import {
  buildTaskTransitionCommand,
  createClosureTransitionMetadata,
  writeTaskDocumentWithTransition
} from '../close-helpers/task-transition-writer.ts';

export async function executeCloseWrites(input: {
  readonly options: any;
  readonly actorId: string;
  readonly taskPath: string;
  readonly previousTaskContent: string;
  readonly taskDocument: Record<string, unknown>;
  readonly activeSession: { readonly sessionId?: string | null } | null;
  readonly previousStatus: string;
  readonly owningBatch: { readonly batchId?: string | null } | null;
  readonly effectiveHistoricalDeliveryRefs: readonly string[];
  readonly pendingClosurePacket: ClosurePacket | null;
  readonly createdClosurePacketAbsolute: string | null;
  readonly closurePacketPath: string | null;
  readonly closurePacket: ClosurePacket | null;
}) {
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
