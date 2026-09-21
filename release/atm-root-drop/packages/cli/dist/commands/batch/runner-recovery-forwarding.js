import { spawnSync } from 'node:child_process';
export function buildBatchCheckpointRunnerRecoveryArgs(emergencyApproval) {
    return emergencyApproval
        ? ['--emergency-approval', emergencyApproval, '--allow-stale-runner']
        : [];
}
export function categorizeCheckpointCloseFailure(closeResult, taskId, actorId, cwd = process.cwd()) {
    const messages = Array.isArray(closeResult.messages) ? closeResult.messages : [];
    const errorMsg = messages.find((item) => typeof item.code === 'string' && item.code.startsWith('ATM_TASK_CLOSE'))
        ?? messages.find((item) => typeof item.code === 'string')
        ?? null;
    const code = errorMsg?.code ?? 'ATM_TASK_CLOSE_UNKNOWN';
    const tldr = typeof errorMsg?.data?.tldr === 'string' ? errorMsg.data.tldr : null;
    const missingValidationPasses = Array.isArray(errorMsg?.data?.missingValidationPasses)
        ? errorMsg.data.missingValidationPasses
        : [];
    const blockingFindings = Array.isArray(errorMsg?.data?.blockingFindings)
        ? errorMsg.data.blockingFindings
        : [];
    if (code === 'ATM_TASK_CLOSE_EVIDENCE_REQUIRED' || code === 'ATM_TASK_CLOSE_CLOSURE_PACKET_INVALID') {
        return checkpointCloseFailure('missing-evidence', tldr ?? `Task ${taskId} lacks required command-backed evidence or a valid closure packet.`, `node atm.mjs evidence missing --task ${taskId} --actor ${actorId} --json`, tldr, missingValidationPasses, blockingFindings);
    }
    if (code === 'ATM_RUNNER_STALE_WRITE_REFUSED' || code === 'ATM_RUNNER_SYNC_QUEUE_HEAD_REQUIRED') {
        const sealedSourceSha = readGitHead(cwd) ?? '<sealed-source-sha>';
        const nextCommand = `node atm.mjs broker runner-sync enqueue --task ${taskId} --actor ${actorId} --sealed-source-sha ${sealedSourceSha} --surface release/atm-onefile/atm.mjs --surface release/atm-root-drop --json`;
        return checkpointCloseFailure('runner-sync-required', tldr ?? `Task ${taskId} checkpoint needs a runner-sync steward ticket before frozen-runner write close can proceed.`, nextCommand, tldr, missingValidationPasses, blockingFindings, buildRecoveryBridge(taskId, actorId, sealedSourceSha, nextCommand));
    }
    if (code === 'ATM_SOURCE_FIRST_WRITE_REFUSED') {
        const nextCommand = `node atm.mjs batch checkpoint --actor ${actorId} --json`;
        return checkpointCloseFailure('source-first-write-refused', tldr ?? `Task ${taskId} checkpoint attempted source-first write semantics; rerun through frozen node atm.mjs after runner-sync is satisfied.`, nextCommand, tldr, missingValidationPasses, blockingFindings, buildRecoveryBridge(taskId, actorId, readGitHead(cwd), nextCommand));
    }
    if (code === 'ATM_BROKER_SHARED_QUEUE_BLOCKED')
        return checkpointCloseFailure('broker-shared-queue-blocked', tldr ?? `Task ${taskId} checkpoint is blocked by a shared-surface broker queue; inspect the broker ticket/status before retrying.`, `node atm.mjs broker status --task ${taskId} --json`, tldr, missingValidationPasses, blockingFindings);
    if (code === 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED')
        return checkpointCloseFailure('missing-deliverable', `Task ${taskId} has no real non-.atm deliverable diff; implement the required files first.`, null, tldr, missingValidationPasses, blockingFindings);
    if (code === 'ATM_TASK_CLOSE_FRAMEWORK_DIFF_ACTIVE' || code === 'ATM_TASK_CLOSE_FRAMEWORK_GATE_FAILED')
        return checkpointCloseFailure('framework-gate-failed', tldr ?? `Task ${taskId} cannot close due to ATM framework delivery window or gate blocker.`, typeof errorMsg?.data?.requiredCommand === 'string' ? errorMsg.data.requiredCommand : null, tldr, missingValidationPasses, blockingFindings);
    if (code === 'ATM_TASK_CLOSE_ACTIVE_CLAIM_REQUIRED')
        return checkpointCloseFailure('no-active-claim', `Task ${taskId} has no active claim owned by ${actorId}.`, `node atm.mjs next --claim --actor ${actorId} --prompt "${taskId}" --json`, tldr, missingValidationPasses, blockingFindings);
    if (code === 'ATM_TASK_CLOSE_OWNER_MISMATCH')
        return checkpointCloseFailure('owner-mismatch', `Task ${taskId} is owned by a different actor; use takeover or correct --actor.`, `node atm.mjs tasks takeover --task ${taskId} --actor ${actorId} --json`, tldr, missingValidationPasses, blockingFindings);
    return checkpointCloseFailure('close-failed', `Task ${taskId} close returned ok=false (code: ${code}).`, null, tldr, missingValidationPasses, blockingFindings);
}
function checkpointCloseFailure(category, reason, requiredCommand, tldr, missingValidationPasses, blockingFindings, recoveryBridge = null) {
    return { category, reason, requiredCommand, tldr, missingValidationPasses, blockingFindings, recoveryBridge };
}
function buildRecoveryBridge(taskId, actorId, candidateHead, nextCommand) {
    return {
        schemaId: 'atm.batchCheckpointRecoveryBridge.v1',
        taskId,
        actorId,
        candidateHead,
        lifecycleMutation: false,
        nextCommand
    };
}
function readGitHead(cwd) {
    const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() || null : null;
}
