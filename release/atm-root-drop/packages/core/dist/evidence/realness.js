export const evidenceRealnessLevels = [
    'fixture',
    'unit',
    'command-smoke',
    'integration',
    'sealed-replay',
    'real-dogfood',
    'production-ledger'
];
const sha256Pattern = /^sha256:[a-f0-9]{64}$/i;
export function isEvidenceRealness(value) {
    return typeof value === 'string'
        && evidenceRealnessLevels.includes(value);
}
export function compareEvidenceRealness(left, right) {
    return evidenceRealnessLevels.indexOf(left) - evidenceRealnessLevels.indexOf(right);
}
export function evidenceMeetsRequiredRealness(verified, required) {
    return verified !== null && compareEvidenceRealness(verified, required) >= 0;
}
export function assessEvidenceRealness(observation) {
    const declaredRealness = isEvidenceRealness(observation.declaredRealness)
        ? observation.declaredRealness
        : null;
    const reasons = [];
    if (observation.declaredRealness !== undefined && declaredRealness === null) {
        reasons.push('unknown-declared-realness');
    }
    const verifiedRealness = highestVerifiedRealness(observation, reasons);
    const satisfiesDeclaredRealness = declaredRealness !== null
        && evidenceMeetsRequiredRealness(verifiedRealness, declaredRealness);
    if (declaredRealness !== null && !satisfiesDeclaredRealness) {
        reasons.push(`declared-${declaredRealness}-not-verified`);
    }
    return {
        declaredRealness,
        verifiedRealness,
        satisfiesDeclaredRealness,
        reasons: uniqueStrings(reasons)
    };
}
function highestVerifiedRealness(observation, reasons) {
    const commandBacked = hasCommandBackedProof(observation.commandProof);
    const substantiveCommand = commandBacked && isSubstantiveCommand(observation.commandProof.command);
    const sealedReplay = commandBacked
        && isDigest(observation.sealedScenarioDigest)
        && isDigest(observation.runnerDigest)
        && isDigest(observation.workloadDigest);
    // Taxonomy extensions belong in the exported registry and schema, never in caller labels.
    const realDogfood = sealedReplay
        && uniqueCount(observation.taskIds) >= 2
        && uniqueCount(observation.actorIds) >= 2
        && uniqueCount(observation.processIds) >= 2
        && uniqueDigestCount(observation.taskIdentityDigests) >= 2
        && uniqueDigestCount(observation.actorIdentityDigests) >= 2
        && uniqueDigestCount(observation.processIdentityDigests) >= 2
        && nonEmptyStrings(observation.canonicalEventRefs).length > 0
        && isDigest(observation.eventChainDigest)
        && (observation.syntheticSignals?.length ?? 0) === 0;
    if (realDogfood && nonEmpty(observation.productionLedgerRef) && isDigest(observation.authorityDigest)) {
        return 'production-ledger';
    }
    if (realDogfood)
        return 'real-dogfood';
    if (sealedReplay)
        return 'sealed-replay';
    if (commandBacked && uniqueCount(observation.integrationParticipants) >= 2)
        return 'integration';
    if (substantiveCommand)
        return 'command-smoke';
    if (commandBacked && nonEmpty(observation.testId))
        return 'unit';
    if (isDigest(observation.fixtureDigest))
        return 'fixture';
    if (observation.commandProof && !commandBacked)
        reasons.push('command-proof-incomplete');
    if (commandBacked && !substantiveCommand)
        reasons.push('command-is-non-substantive');
    reasons.push('no-verifiable-realness-properties');
    return null;
}
function hasCommandBackedProof(proof) {
    return Boolean(proof
        && proof.command.trim()
        && proof.exitCode === 0
        && isDigest(proof.stdoutDigest)
        && isDigest(proof.stderrDigest));
}
function isSubstantiveCommand(command) {
    const normalized = command.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!normalized)
        return false;
    return !(/^(?:echo|write-output)\b/.test(normalized)
        || /(?:^|\s)(?:sleep|start-sleep)(?:\s|$)/.test(normalized)
        || /(?:^|\s)node\s+atm(?:\.dev)?\.mjs\s+--version(?:\s|$)/.test(normalized)
        || /(?:^|\s)(?:noop|no-op)(?:\s|$)/.test(normalized)
        || /candidate[- ]selection/.test(normalized));
}
function isDigest(value) {
    return typeof value === 'string' && sha256Pattern.test(value.trim());
}
function nonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function nonEmptyStrings(value) {
    return Array.isArray(value) ? value.map(String).map((entry) => entry.trim()).filter(Boolean) : [];
}
function uniqueCount(value) {
    return new Set(nonEmptyStrings(value)).size;
}
function uniqueDigestCount(value) {
    return new Set(nonEmptyStrings(value).filter(isDigest)).size;
}
function uniqueStrings(values) {
    return [...new Set(values)];
}
