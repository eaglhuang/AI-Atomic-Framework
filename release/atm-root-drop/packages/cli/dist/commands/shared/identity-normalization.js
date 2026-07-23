export const explicitActorIdEnvVar = 'ATM_ACTOR_ID';
export const legacyActorIdEnvVar = 'AGENT_IDENTITY';
export function normalizeIdentitySegment(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}
export function mintFrameworkTempTaskId(actorId) {
    const normalized = normalizeIdentitySegment(actorId);
    return `ATM-FRAMEWORK-TEMP-${normalized || 'unknown-actor'}`;
}
export function sanitizeIdentityValue(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
/**
 * Resolve the actor that may mutate shared-write surfaces.
 * Explicit CLI/--actor and ATM_ACTOR_ID stay authoritative.
 * AGENT_IDENTITY is diagnostic-only when it disagrees with the active lane,
 * claim, or queue-head owner, and must never silently replace them.
 */
export function resolveSharedWriteActorAuthority(input) {
    const explicitActorId = sanitizeIdentityValue(input.explicitActorId);
    const envActorId = sanitizeIdentityValue(input.envActorId);
    const legacyEnvActorId = sanitizeIdentityValue(input.legacyEnvActorId);
    const repoDefaultActorId = sanitizeIdentityValue(input.repoDefaultActorId);
    const activeClaimOwnerActorId = sanitizeIdentityValue(input.activeClaimOwnerActorId);
    const laneSessionId = sanitizeIdentityValue(input.laneSessionId);
    const queueHeadOwnerActorIds = uniqueSorted((input.queueHeadOwnerActorIds ?? [])
        .map((entry) => sanitizeIdentityValue(entry))
        .filter((entry) => Boolean(entry)));
    const buildCommand = sanitizeIdentityValue(input.buildCommand) ?? 'npm run build';
    let actorId = null;
    let resolutionSource = 'insufficient';
    if (explicitActorId) {
        actorId = explicitActorId;
        resolutionSource = 'option';
    }
    else if (envActorId) {
        actorId = envActorId;
        resolutionSource = 'env';
    }
    else if (queueHeadOwnerActorIds.length === 1) {
        actorId = queueHeadOwnerActorIds[0] ?? null;
        resolutionSource = 'queue-head';
    }
    else if (activeClaimOwnerActorId) {
        actorId = activeClaimOwnerActorId;
        resolutionSource = 'active-lane';
    }
    else if (repoDefaultActorId) {
        actorId = repoDefaultActorId;
        resolutionSource = 'repo-default';
    }
    const legacyEnvDisagrees = Boolean(legacyEnvActorId
        && ((actorId !== null && legacyEnvActorId !== actorId)
            || (queueHeadOwnerActorIds.length > 0 && !queueHeadOwnerActorIds.includes(legacyEnvActorId))
            || (activeClaimOwnerActorId !== null && legacyEnvActorId !== activeClaimOwnerActorId)));
    if (!actorId) {
        const preferredOwner = queueHeadOwnerActorIds[0]
            ?? activeClaimOwnerActorId
            ?? repoDefaultActorId
            ?? null;
        return {
            schemaId: 'atm.sharedWriteActorAuthority.v1',
            ok: false,
            actorId: null,
            resolutionSource: 'insufficient',
            legacyEnvActorId,
            legacyEnvDisagrees: Boolean(legacyEnvActorId),
            laneSessionId,
            queueHeadOwnerActorIds,
            activeClaimOwnerActorId,
            recoveryCommand: preferredOwner
                ? buildSharedWriteActorRecoveryCommand({ actorId: preferredOwner, buildCommand })
                : `node atm.mjs identity set --actor <actor-id> --editor <editor-id> --git-name "<git user.name>" --git-email "<git user.email>" --json`,
            reason: legacyEnvActorId
                ? `${legacyActorIdEnvVar} is diagnostic-only for shared-write lanes; set ${explicitActorIdEnvVar} or pass --actor before mutation.`
                : `Shared-write mutation requires an explicit actor via --actor or ${explicitActorIdEnvVar}.`
        };
    }
    if (queueHeadOwnerActorIds.length > 0 && !queueHeadOwnerActorIds.includes(actorId)) {
        const owner = queueHeadOwnerActorIds[0] ?? null;
        return {
            schemaId: 'atm.sharedWriteActorAuthority.v1',
            ok: false,
            actorId,
            resolutionSource,
            legacyEnvActorId,
            legacyEnvDisagrees: true,
            laneSessionId,
            queueHeadOwnerActorIds,
            activeClaimOwnerActorId,
            recoveryCommand: owner
                ? buildSharedWriteActorRecoveryCommand({ actorId: owner, buildCommand })
                : null,
            reason: `Resolved actor ${actorId} does not own the shared-write queue head (${queueHeadOwnerActorIds.join(', ')}).`
        };
    }
    if (activeClaimOwnerActorId && actorId !== activeClaimOwnerActorId && resolutionSource !== 'option' && resolutionSource !== 'env') {
        return {
            schemaId: 'atm.sharedWriteActorAuthority.v1',
            ok: false,
            actorId,
            resolutionSource,
            legacyEnvActorId,
            legacyEnvDisagrees: true,
            laneSessionId,
            queueHeadOwnerActorIds,
            activeClaimOwnerActorId,
            recoveryCommand: buildSharedWriteActorRecoveryCommand({
                actorId: activeClaimOwnerActorId,
                buildCommand
            }),
            reason: `Active claim owner ${activeClaimOwnerActorId} must remain authoritative across shared-write child commands.`
        };
    }
    return {
        schemaId: 'atm.sharedWriteActorAuthority.v1',
        ok: true,
        actorId,
        resolutionSource,
        legacyEnvActorId,
        legacyEnvDisagrees,
        laneSessionId,
        queueHeadOwnerActorIds,
        activeClaimOwnerActorId,
        recoveryCommand: null,
        reason: legacyEnvDisagrees
            ? `${legacyActorIdEnvVar}=${legacyEnvActorId} is diagnostic-only and does not replace authoritative actor ${actorId}.`
            : null
    };
}
export function buildSharedWriteActorRecoveryCommand(input) {
    const buildCommand = sanitizeIdentityValue(input.buildCommand) ?? 'npm run build';
    return `${explicitActorIdEnvVar}=${quoteShellAssignmentValue(input.actorId)} ${buildCommand}`;
}
export function quoteShellAssignmentValue(value) {
    return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : JSON.stringify(String(value));
}
function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
