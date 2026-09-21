import { sha256Digest } from '../census/index.js';
export function createReplayRunManifest(input) {
    const withoutDigest = {
        schemaId: 'atm.replayRunManifest.v1',
        specVersion: '0.1.0',
        runId: input.runId,
        generatedAt: input.generatedAt ?? new Date(0).toISOString(),
        participants: [...input.participants].map(normalizeParticipant).sort(compareBy('participantId')),
        sharedPhysicalFile: normalizePath(input.sharedPhysicalFile),
        logicalIntents: [...input.logicalIntents].map(normalizeIntent).sort(compareBy('intentId')),
        validatorSeal: { ...input.validatorSeal },
        thresholds: sortRecord(input.thresholds),
        timeWindow: { ...input.timeWindow },
        stopRule: input.stopRule
    };
    return { ...withoutDigest, digest: sha256Digest(withoutDigest) };
}
export function buildReplayDashboardSnapshot(input) {
    const manifest = createReplayRunManifest(input);
    const participants = manifest.participants;
    const logicalIntents = manifest.logicalIntents;
    const actorCount = distinct(participants.map((entry) => entry.actorId)).size;
    const processCount = distinct(participants.map((entry) => entry.processId == null ? '' : String(entry.processId)).filter(Boolean)).size;
    const worktreeRootCount = distinct(participants.map((entry) => entry.worktreeRoot)).size;
    const baseDigestCount = distinct(participants.map((entry) => entry.baseDigest)).size;
    const headDigestCount = distinct(participants.map((entry) => entry.headDigest)).size;
    const buildDigestCount = distinct(participants.map((entry) => entry.buildDigest)).size;
    const runnerDigestCount = distinct(participants.map((entry) => entry.runnerDigest)).size;
    const intentDigestCount = distinct(logicalIntents.map((entry) => entry.digest)).size;
    const predicates = [
        predicate('participants.two-or-more', participants.length >= 2, `${participants.length} participant(s) observed`),
        predicate('participants.distinct-actors', actorCount >= 2, `${actorCount} actor(s) observed`),
        predicate('participants.distinct-processes', processCount >= 2, `${processCount} process id(s) observed`),
        predicate('canonical-worktree.single-root', worktreeRootCount === 1, `${worktreeRootCount} canonical worktree root(s) observed`),
        predicate('canonical-source.single-base', baseDigestCount === 1, `${baseDigestCount} base digest(s) observed`),
        predicate('canonical-source.single-head', headDigestCount === 1, `${headDigestCount} head digest(s) observed`),
        predicate('canonical-build.single-build', buildDigestCount === 1, `${buildDigestCount} build digest(s) observed`),
        predicate('canonical-runner.single-runner', runnerDigestCount === 1, `${runnerDigestCount} runner digest(s) observed`),
        predicate('shared-file.present', Boolean(manifest.sharedPhysicalFile), `shared file: ${manifest.sharedPhysicalFile || 'missing'}`),
        predicate('logical-intents.distinct', logicalIntents.length >= 2 && intentDigestCount === logicalIntents.length, `${logicalIntents.length} logical intent(s), ${intentDigestCount} digest(s)`),
        predicate('validator.policy-sealed', Boolean(manifest.validatorSeal.policyDigest && manifest.validatorSeal.unionDigest && manifest.validatorSeal.selectionInputDigest), 'validator policy, union, and selection digests must be sealed before payload reveal'),
        predicate('validator.negative-control-revealed', Boolean(manifest.validatorSeal.negativeControlRevealedAt), 'negative control reveal timestamp must be present'),
        predicate('validator.union-not-mutated', !manifest.validatorSeal.currentUnionDigest || manifest.validatorSeal.currentUnionDigest === manifest.validatorSeal.unionDigest, 'current validator union must match sealed union'),
        predicate('admission.facade-required', input.admissionFacadeDisposition === 'required', `admission facade disposition: ${input.admissionFacadeDisposition}`),
        predicate('recovery.no-cleanup-required', !input.cleanupRequired && !input.manualRecoveryRequired, 'cleanup/manual recovery must not be required for readiness'),
        predicate('conflict.not-true-conflict', !input.trueConflict, 'true conflicts are not ready'),
        predicate('fallback.not-stale', !input.staleFallbackUsed, 'stale fallback readiness is fail-closed')
    ];
    const blockers = predicates.filter((entry) => entry.status !== 'pass').map((entry) => `${entry.id}: ${entry.reason}`);
    const withoutDigest = {
        schemaId: 'atm.replayDashboardSnapshot.v1',
        manifest,
        readiness: blockers.length === 0 ? 'ready' : 'not-ready',
        predicates,
        blockers,
        observations: {
            participantCount: participants.length,
            actorCount,
            processCount,
            worktreeRootCount,
            baseDigestCount,
            headDigestCount,
            buildDigestCount,
            runnerDigestCount,
            sharedPhysicalFile: manifest.sharedPhysicalFile,
            logicalIntentCount: logicalIntents.length,
            logicalIntentDigestCount: intentDigestCount,
            nonGitProposalRootCount: logicalIntents.filter((entry) => entry.proposalRoot).length,
            commandCount: input.commands?.length ?? 0,
            usageErrorCount: input.usageErrors?.length ?? 0,
            continuationCount: input.continuations?.length ?? 0,
            terminalPruneCount: input.terminalPrunes?.length ?? 0,
            manualInterventionCount: input.manualInterventions?.length ?? 0,
            falseStopCount: input.falseStops?.length ?? 0,
            unavailableReceiptCount: input.unavailableReceipts?.length ?? 0,
            candidateOutputDigestCount: input.candidateOutputDigests?.length ?? 0,
            validatorRunDigestCount: input.validatorRunDigests?.length ?? 0,
            authorityLaneCount: distinct(participants.map((entry) => entry.authority?.lane ?? '').filter(Boolean)).size
        },
        decisions: {
            adapterDecision: input.adapterDecision ?? null,
            safeCompose: input.safeCompose ?? false,
            staleFallbackUsed: input.staleFallbackUsed ?? false,
            trueConflict: input.trueConflict ?? false,
            admissionFacadeDisposition: input.admissionFacadeDisposition,
            publicationStatus: input.publication?.status ?? null,
            sourceAvailable: input.publication?.sourceAvailable ?? false
        }
    };
    return { ...withoutDigest, digest: sha256Digest(withoutDigest) };
}
export function renderReplayDashboardHuman(snapshot) {
    const failed = snapshot.predicates.filter((entry) => entry.status !== 'pass');
    return [
        `Replay dashboard: ${snapshot.readiness}`,
        `digest: ${snapshot.digest}`,
        `participants: ${snapshot.observations.participantCount} (${snapshot.observations.actorCount} actors, ${snapshot.observations.processCount} processes)`,
        `shared file: ${snapshot.observations.sharedPhysicalFile}`,
        `logical intents: ${snapshot.observations.logicalIntentCount}`,
        `validator union: ${snapshot.manifest.validatorSeal.unionDigest}`,
        `admission facade: ${snapshot.decisions.admissionFacadeDisposition}`,
        failed.length === 0 ? 'blockers: none' : `blockers: ${failed.map((entry) => entry.id).join(', ')}`
    ].join('\n');
}
function normalizeParticipant(participant) {
    return {
        ...participant,
        worktreeRoot: normalizePath(participant.worktreeRoot),
        selectedTaskIds: participant.selectedTaskIds ? [...participant.selectedTaskIds].sort() : undefined,
        queuedTaskIds: participant.queuedTaskIds ? [...participant.queuedTaskIds].sort() : undefined
    };
}
function normalizeIntent(intent) {
    return { ...intent, physicalPath: normalizePath(intent.physicalPath), proposalRoot: intent.proposalRoot ? normalizePath(intent.proposalRoot) : intent.proposalRoot };
}
function predicate(id, pass, reason) {
    return { id, status: pass ? 'pass' : 'fail', reason };
}
function normalizePath(value) {
    return String(value ?? '').trim().replace(/\\/g, '/');
}
function distinct(values) {
    return new Set(values.filter(Boolean));
}
function compareBy(key) {
    return (left, right) => String(left[key]).localeCompare(String(right[key]));
}
function sortRecord(record) {
    return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}
