import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { digestStagedCandidate, writeCloseTransactionHookReceipt } from '../hook/pre-commit/close-transaction-receipt.js';
function runGit(root, args, env) {
    execFileSync('git', [...args], { cwd: root, env, stdio: 'ignore' });
}
/**
 * Issue the capability from the exact temporary index that the follow-up commit
 * will use.  It never inspects or changes the live index.
 */
export function issueCloseTransactionHookReceipt(input) {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-close-hook-receipt-'));
    const tempIndex = path.join(tempDir, 'index');
    const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
    try {
        runGit(input.root, ['read-tree', 'HEAD'], env);
        if (input.stageFiles.length > 0)
            runGit(input.root, ['add', '-A', '-f', '--', ...input.stageFiles], env);
        const digest = digestStagedCandidate(input.root, input.stageFiles, env);
        return digest ? writeCloseTransactionHookReceipt({
            root: input.root,
            taskId: input.taskId,
            actorId: input.actorId,
            invocationNonce: input.invocationNonce,
            commitSurface: 'taskflow-close-governance-followup',
            closeWindowLock: input.closeWindowLock,
            parentHead: input.parentHead,
            candidateDigest: digest
        }) : null;
    }
    finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}
