/**
 * `broker claim` — prereg v3 W4 file-level claim share layer.
 * This handler only talks to the separate claim-share registry; broker decisions are untouched.
 */
import { CliError, makeResult, message } from '../shared.js';
import { claimFiles, claimShareStatus, initClaimShare, recordStewardOutcomes, recordUnclaimedWrites, releaseClaimFiles } from '../../_vendor/core/dist/claim-share/claim-share.js';
import { claimShareRegistryRelativePath, defaultClaimTtlSeconds, isClaimShareActive } from '../../_vendor/core/dist/claim-share/claim-share-store.js';
import { claimEventLogRelativePath } from '../../_vendor/core/dist/claim-share/claim-event-log.js';
import path from 'node:path';
/** First positional token of a broker argv, skipping `--flag value` pairs. */
export function firstBrokerPositional(argv) {
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg.startsWith('--'))
            return arg;
        if (argv[index + 1] !== undefined && !argv[index + 1].startsWith('--'))
            index += 1;
    }
    return null;
}
export function parseClaimShareArgs(argv) {
    if (firstBrokerPositional(argv) !== 'claim')
        return null;
    let cwd = process.cwd();
    let actorId = null;
    let claimAction = null;
    let ttlSeconds = defaultClaimTtlSeconds;
    const claimFiles = [];
    let sawClaim = false;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd' || arg === '--actor' || arg === '--files' || arg === '--ttl-seconds') {
            const value = argv[index + 1];
            if (!value || value.startsWith('--'))
                throw new CliError('ATM_CLI_USAGE', `broker requires a value for ${arg}`, { exitCode: 2 });
            index += 1;
            if (arg === '--cwd')
                cwd = value;
            else if (arg === '--actor')
                actorId = value;
            else if (arg === '--files')
                claimFiles.push(...value.split(',').map((file) => file.trim()).filter((file) => file.length > 0));
            else {
                const parsed = Number.parseInt(value, 10);
                if (!Number.isFinite(parsed) || parsed <= 0)
                    throw new CliError('ATM_CLI_USAGE', '--ttl-seconds must be a positive integer.', { exitCode: 2 });
                ttlSeconds = parsed;
            }
            continue;
        }
        if (arg.startsWith('--'))
            throw new CliError('ATM_CLI_USAGE', `broker claim does not support option ${arg}`, { exitCode: 2 });
        if (!sawClaim && arg === 'claim') {
            sawClaim = true;
            continue;
        }
        if (claimAction === null && (arg === 'init' || arg === 'release' || arg === 'status')) {
            claimAction = arg;
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', 'broker claim accepts: [init | release | status] --files <a,b> --actor <id> --ttl-seconds <n>.', { exitCode: 2 });
    }
    return { action: 'claim', cwd: path.resolve(cwd), actorId, claimAction, claimFiles, ttlSeconds };
}
export function resolveClaimActor(explicit) {
    const actor = (explicit ?? process.env.ATM_ACTOR_ID ?? '').trim();
    return actor.length > 0 ? actor : null;
}
function inactiveError(options) {
    return new CliError('ATM_CLAIM_SHARE_INACTIVE', `Claim share layer is not initialised here. Run: node atm.mjs broker claim init --cwd ${options.cwd}`, {
        exitCode: 2,
        details: { registryPath: claimShareRegistryRelativePath }
    });
}
export function handleBrokerClaimShareActions(argv) {
    const options = parseClaimShareArgs(argv);
    if (!options)
        return null;
    const evidenceBase = { action: `claim-${options.claimAction ?? 'grant'}`, registryPath: claimShareRegistryRelativePath, eventLogPath: claimEventLogRelativePath };
    if (options.claimAction === 'init') {
        const { created } = initClaimShare(options.cwd);
        return makeResult({
            ok: true,
            command: 'broker',
            cwd: options.cwd,
            messages: [message('info', 'ATM_CLAIM_SHARE_INITIALISED', created ? 'Claim share layer switched on.' : 'Claim share layer was already on.', { created })],
            evidence: { ...evidenceBase, created }
        });
    }
    if (options.claimAction === 'status') {
        const status = claimShareStatus({ cwd: options.cwd });
        if (!status)
            throw inactiveError(options);
        return makeResult({
            ok: true,
            command: 'broker',
            cwd: options.cwd,
            messages: [message('info', 'ATM_CLAIM_SHARE_STATUS', `${status.claims.length} live claim(s).`, { claimCount: status.claims.length })],
            evidence: { ...evidenceBase, ...status }
        });
    }
    const actorId = resolveClaimActor(options.actorId);
    if (!actorId) {
        throw new CliError('ATM_CLI_USAGE', 'broker claim needs --actor <id> or ATM_ACTOR_ID.', { exitCode: 2 });
    }
    if (!isClaimShareActive(options.cwd))
        throw inactiveError(options);
    if (options.claimAction === 'release') {
        const released = releaseClaimFiles({ cwd: options.cwd, actorId, files: options.claimFiles });
        if (!released)
            throw inactiveError(options);
        return makeResult({
            ok: true,
            command: 'broker',
            cwd: options.cwd,
            messages: [message('info', 'CLAIM_RELEASED', released.releasedFiles.length > 0 ? `Released ${released.releasedFiles.join(', ')}.` : 'Nothing to release.', { releasedFiles: released.releasedFiles })],
            evidence: { ...evidenceBase, actorId, ...released }
        });
    }
    if (options.claimFiles.length === 0) {
        throw new CliError('ATM_CLI_USAGE', 'broker claim requires --files <a,b,...>.', { exitCode: 2 });
    }
    const outcome = claimFiles({
        cwd: options.cwd,
        actorId,
        files: options.claimFiles,
        ttlSeconds: options.ttlSeconds
    });
    if (!outcome)
        throw inactiveError(options);
    const messages = [
        message(outcome.code === 'CLAIM_OVERLAP' ? 'warn' : 'info', outcome.code, outcome.message, {
            files: outcome.code === 'CLAIM_OVERLAP' ? outcome.overlapFiles : outcome.files,
            writeAuthorized: true
        }),
        ...outcome.notices.map((notice) => message('warn', notice.code, notice.message, { files: notice.files, noticeId: notice.noticeId }))
    ];
    return makeResult({
        ok: true,
        command: 'broker',
        cwd: options.cwd,
        messages,
        evidence: {
            ...evidenceBase,
            actorId,
            claimId: outcome.claimId,
            files: outcome.files,
            overlapFiles: outcome.overlapFiles,
            expiresAt: outcome.expiresAt,
            writeAuthorized: true,
            claimShareNotices: outcome.notices
        }
    });
}
/** apply-live pre-hook: unclaimed writes are allowed, logged and auto-claimed. No-op when the layer is off. */
export function claimShareBeforeLiveApply(cwd, proposals) {
    if (!isClaimShareActive(cwd))
        return null;
    return recordUnclaimedWrites({
        cwd,
        writes: proposals.map((proposal) => ({ actorId: proposal.actorId, file: proposal.targetFile, proposalId: proposal.proposalId }))
    });
}
/** apply-live post-hook: log steward accept / reject and release committed files. No-op when the layer is off. */
export function claimShareAfterLiveApply(cwd, proposals, writes) {
    if (!isClaimShareActive(cwd))
        return null;
    const actorByProposal = new Map(proposals.map((proposal) => [proposal.proposalId, proposal.actorId]));
    return recordStewardOutcomes({
        cwd,
        writes: writes.map((write) => ({
            actorId: actorByProposal.get(write.proposalId) ?? 'unknown',
            file: write.file,
            proposalId: write.proposalId,
            decision: write.decision,
            reasonCode: write.reasonCode,
            commitSha: write.commitSha
        }))
    });
}
