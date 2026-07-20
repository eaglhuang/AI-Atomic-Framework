import { CliError } from '../../shared.js';
import { uniqueStrings } from '../../tasks.js';
import { loadHistoricalBatchCloseSlice } from '../close-helpers/close-window-diagnostics.js';
export function resolveCloseHistoricalContext(options) {
    let historicalBatchSlice = null;
    let effectiveHistoricalDeliveryRefs = [...options.historicalDeliveryRefs];
    if (options.historicalBatchRef) {
        historicalBatchSlice = loadHistoricalBatchCloseSlice(options.cwd, options.taskId, options.historicalBatchRef);
        if (!historicalBatchSlice.okToCloseTask) {
            throw new CliError('ATM_TASK_CLOSE_HISTORICAL_BATCH_NOT_CLOSE_READY', `Task ${options.taskId} cannot close from historical batch ${historicalBatchSlice.batchId} because the slice is not close-ready.`, {
                exitCode: 1,
                details: {
                    taskId: options.taskId,
                    batchId: historicalBatchSlice.batchId,
                    batchPath: historicalBatchSlice.batchPath,
                    coverageStatus: historicalBatchSlice.coverageStatus,
                    okToRecordEvidence: historicalBatchSlice.okToRecordEvidence,
                    okToCloseTask: historicalBatchSlice.okToCloseTask,
                    diagnosticOnly: historicalBatchSlice.diagnosticOnly,
                    missingCoverage: historicalBatchSlice.missingCoverage,
                    taskSpecificValidationPasses: historicalBatchSlice.taskSpecificValidationPasses
                }
            });
        }
        effectiveHistoricalDeliveryRefs = uniqueStrings([...effectiveHistoricalDeliveryRefs, ...historicalBatchSlice.matchedCommits]);
    }
    const allowHistoricalCloseback = effectiveHistoricalDeliveryRefs.length > 0 || Boolean(options.historicalBatchRef);
    const governedHistoricalBatchCheckpoint = options.fromBatchCheckpoint === true
        && historicalBatchSlice?.okToCloseTask === true
        && options.historicalDeliveryRefs.length === 0;
    const protectedCloseFlags = [
        ...(effectiveHistoricalDeliveryRefs.length > 0 && !governedHistoricalBatchCheckpoint ? ['--historical-delivery'] : []),
        ...(options.historicalBatchRef && !governedHistoricalBatchCheckpoint ? ['--historical-batch'] : []),
        ...(options.historicalDeliveryRepo ? ['--historical-delivery-repo'] : []),
        ...(options.waiverOutOfScopeDelivery ? ['--waiver-out-of-scope-delivery'] : []),
        ...(options.allowStaleRunner ? ['--allow-stale-runner'] : [])
    ];
    const requiresProtectedCloseApproval = protectedCloseFlags.length > 0;
    return {
        historicalBatchSlice,
        effectiveHistoricalDeliveryRefs,
        allowHistoricalCloseback,
        governedHistoricalBatchCheckpoint,
        protectedCloseFlags,
        requiresProtectedCloseApproval,
        shouldDeferProtectedCloseApproval: requiresProtectedCloseApproval && !options.allowStaleRunner
    };
}
