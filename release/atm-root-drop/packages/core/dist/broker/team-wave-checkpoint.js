import { effectiveExecutionState } from './team-worker-report.js';
/**
 * Resolve each member's checkpoint state. The wave evidence gate is authoritative:
 * if the slice is `needs-review`, NO member is close-ready regardless of its own
 * report (spec §7 — ambiguous attribution blocks the whole wave). Otherwise a
 * member is close-ready only when its reconciled worker state is `done`.
 */
export function checkpointWave(input) {
    const evidenceClean = input.evidence.state === 'done';
    const attributed = new Map(input.evidence.slices.map((s) => [s.taskId, s.attributedFiles]));
    const members = input.members.map((member) => {
        if (!member.report) {
            return {
                taskId: member.taskId,
                state: 'not-started',
                closeReady: false,
                reason: 'no worker report'
            };
        }
        const reported = effectiveExecutionState(member.report);
        if (!evidenceClean) {
            return {
                taskId: member.taskId,
                state: 'needs-review',
                closeReady: false,
                reason: 'wave evidence did not slice cleanly; whole wave is needs-review'
            };
        }
        const hasFiles = (attributed.get(member.taskId) ?? []).length > 0;
        if (reported === 'done' && !hasFiles) {
            return {
                taskId: member.taskId,
                state: 'needs-review',
                closeReady: false,
                reason: 'reported done but no files attributed in the wave slice'
            };
        }
        const closeReady = reported === 'done';
        return {
            taskId: member.taskId,
            state: reported,
            closeReady,
            reason: closeReady ? 'done with clean attributed evidence' : `member state is ${reported}`
        };
    });
    return {
        schemaId: 'atm.teamWaveCheckpoint.v1',
        members,
        closeReadyTaskIds: members.filter((m) => m.closeReady).map((m) => m.taskId),
        evidenceClean
    };
}
