import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { message } from '../shared.js';
/**
 * A new agent session does not know that an earlier session already claimed
 * a card, so `next` routed "continue" to guidance and `next` alone reported
 * nothing pending. Surface the live claims with the command that resumes one
 * (re-claiming as the same actor returns the playbook and a fresh lane).
 * Claim mode is left alone: it already acts on a specific task.
 */
export function withActiveClaimResume(argv, result) {
    if (argv.includes('--claim'))
        return result;
    const cwdIndex = argv.indexOf('--cwd');
    const cwd = path.resolve(cwdIndex >= 0 && argv[cwdIndex + 1] ? argv[cwdIndex + 1] : process.cwd());
    const claims = readActiveClaims(cwd);
    if (claims.length === 0)
        return result;
    const first = claims[0];
    return {
        ...result,
        messages: [
            ...(result.messages ?? []),
            message('warning', 'ATM_NEXT_ACTIVE_CLAIM_RESUMABLE', `${claims.length} task card(s) are already claimed and in progress (${claims.map((claim) => `${claim.taskId} by ${claim.actorId}`).join(', ')}). To continue one, re-claim it as its owner.`, { requiredCommand: first.resumeCommand, activeClaims: claims })
        ],
        evidence: { ...(result.evidence ?? {}), activeClaims: claims }
    };
}
function readActiveClaims(cwd) {
    const taskRoot = path.join(cwd, '.atm', 'history', 'tasks');
    if (!existsSync(taskRoot))
        return [];
    const claims = [];
    for (const file of readdirSync(taskRoot).filter((name) => name.endsWith('.json')).sort()) {
        try {
            const task = JSON.parse(readFileSync(path.join(taskRoot, file), 'utf8'));
            const claim = task.claim;
            if (!claim || claim.state !== 'active' || typeof claim.actorId !== 'string')
                continue;
            const taskId = String(task.workItemId ?? file.replace(/\.json$/, ''));
            claims.push({
                taskId,
                title: typeof task.title === 'string' ? task.title : null,
                actorId: claim.actorId,
                resumeCommand: `node atm.mjs next --claim --actor ${claim.actorId} --task ${taskId} --auto-intent --json`
            });
        }
        catch {
            // An unreadable ledger is reported by doctor; it is not a resumable claim.
        }
    }
    return claims;
}
