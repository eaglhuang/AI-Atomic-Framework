/**
 * prereg v3 W4 per-command hook. On every atm command of an actor (ATM_ACTOR_ID or --actor)
 * in a repository whose claim share layer is on, sweep expired leases, renew the actor's
 * lease and deliver pending CLAIM_OVERLAP notices through that command's own output.
 * When the layer is off (no registry) this is a cheap existsSync and nothing else.
 */
import path from 'node:path';
import { touchClaimShareActor } from '../../_vendor/core/dist/claim-share/claim-share.js';
import { isClaimShareActive } from '../../_vendor/core/dist/claim-share/claim-share-store.js';
import { message } from './result-core.js';
import { firstBrokerPositional } from '../broker/claim-share-actions.js';
function optionValue(args, name) {
    const index = args.indexOf(name);
    if (index < 0)
        return null;
    const value = args[index + 1];
    return value && !value.startsWith('--') ? value : null;
}
/** `broker claim --files` / `broker claim init` handle delivery themselves. */
function handlesClaimItself(commandName, args) {
    if (commandName !== 'broker' || firstBrokerPositional(args) !== 'claim')
        return false;
    return !args.includes('release') && !args.includes('status');
}
export function touchClaimShareForCommand(commandName, args) {
    if (args.includes('--help') || args.includes('-h') || handlesClaimItself(commandName, args))
        return null;
    const cwd = path.resolve(optionValue(args, '--cwd') ?? process.cwd());
    if (!isClaimShareActive(cwd))
        return null;
    const actorId = (optionValue(args, '--actor') ?? process.env.ATM_ACTOR_ID ?? '').trim();
    if (!actorId)
        return null;
    try {
        const outcome = touchClaimShareActor({ cwd, actorId });
        return { notices: outcome?.notices ?? [], error: null };
    }
    catch (error) {
        return { notices: [], error: error instanceof Error ? error.message : String(error) };
    }
}
export function attachClaimShareTouch(result, touch) {
    if (!touch || (touch.notices.length === 0 && !touch.error))
        return result;
    const extra = touch.notices.map((notice) => message('warn', notice.code, notice.message, { files: notice.files, noticeId: notice.noticeId }));
    if (touch.error)
        extra.push(message('warn', 'ATM_CLAIM_SHARE_TOUCH_FAILED', `Claim share bookkeeping failed: ${touch.error}`));
    return {
        ...result,
        messages: [...(result.messages ?? []), ...extra],
        evidence: { ...(result.evidence ?? {}), claimShareNotices: touch.notices }
    };
}
