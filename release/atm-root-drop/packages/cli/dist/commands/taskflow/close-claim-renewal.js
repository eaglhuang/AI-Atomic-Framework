import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const active = new AsyncLocalStorage();
const CLOSED = new Set(['done', 'review', 'blocked', 'abandoned']);
function task(cwd, taskId) {
    return JSON.parse(readFileSync(path.join(cwd, '.atm/history/tasks', `${taskId}.json`), 'utf8'));
}
export function assertCloseClaimAuthority() {
    const context = active.getStore();
    if (!context)
        return;
    if (context.failure)
        throw context.failure;
    if (!context.leaseId)
        return;
    const current = task(context.cwd, context.taskId);
    if ((!current.claim && !CLOSED.has(String(current.status)))
        || (current.claim && (current.claim.leaseId !== context.leaseId || current.claim.actorId !== context.actorId))
        || (!CLOSED.has(String(current.status)) && current.claim?.state !== 'active')) {
        throw new Error(`ATM_CLOSE_CLAIM_LOST: claim generation changed for ${context.taskId}; stop close writes`);
    }
}
async function renewIfNeeded(context) {
    assertCloseClaimAuthority();
    const current = task(context.cwd, context.taskId), claim = current.claim;
    if (!context.leaseId || current.status !== 'running' || claim?.state !== 'active')
        return;
    const expires = Date.parse(claim.heartbeatAt ?? claim.claimedAt ?? '') + Number(claim.ttlSeconds ?? 0) * 1000;
    if (Number.isFinite(expires) && expires - Date.now() >= 15 * 60 * 1000)
        return;
    if (context.renew)
        await context.renew();
    else {
        const { runTasksClaimLifecycle } = await import('../tasks/claim-orchestrator.js');
        const renewed = await runTasksClaimLifecycle('renew', ['--cwd', context.cwd, '--task', context.taskId, '--actor', context.actorId, '--ttl-seconds', '14400']);
        if (!renewed.ok)
            throw new Error(`ATM_CLOSE_CLAIM_RENEW_FAILED: ${context.taskId}`);
    }
    assertCloseClaimAuthority();
}
/** Drain renewal before taking the write lock. Ordinary tasks renew changes
 * status to running, so it must never overlap the close's ledger transition.
 * A claim with less than fifteen minutes remaining is extended to four
 * hours. The mutex continues heartbeating through writes and cleanup.
 * Begin only after read-only admission has passed. */
export async function beginCloseClaimRenewal() {
    const context = active.getStore();
    if (!context)
        return;
    await renewIfNeeded(context);
    context.paused = false;
}
export async function pauseCloseClaimRenewal() {
    const context = active.getStore();
    if (!context)
        return;
    context.paused = true;
    if (context.pending)
        await context.pending;
    assertCloseClaimAuthority();
    await renewIfNeeded(context);
}
export async function withCloseClaimRenewal(input, action) {
    const claim = task(input.cwd, input.taskId).claim;
    const context = { ...input, leaseId: claim?.state === 'active' ? claim.leaseId ?? null : null, paused: true, failure: null, pending: null };
    return active.run(context, async () => {
        const timer = setInterval(() => {
            if (context.paused || context.pending || context.failure)
                return;
            context.pending = renewIfNeeded(context).catch((error) => { context.failure = error instanceof Error ? error : new Error(String(error)); })
                .finally(() => { context.pending = null; });
        }, 30_000);
        timer.unref();
        try {
            const value = await action();
            assertCloseClaimAuthority();
            return value;
        }
        finally {
            clearInterval(timer);
            context.paused = true;
            if (context.pending)
                await context.pending;
        }
    });
}
