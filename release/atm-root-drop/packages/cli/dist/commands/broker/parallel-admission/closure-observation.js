import { createHash } from 'node:crypto';
export function buildClosureObservation(input) {
    const dispositionSummary = summarizeClosebackDisposition(input.backlogItems);
    const parityEquivalent = new Set([
        input.sourceObservationDigest,
        input.frozenObservationDigest,
        input.packageDistObservationDigest,
        input.releaseProjectionObservationDigest
    ]).size === 1;
    const readinessProbeFailures = [
        ...(!parityEquivalent ? ['source/frozen/package/release closure observation parity mismatch'] : []),
        ...(!input.rollbackDrill.exercised ? ['rollback drill not exercised'] : []),
        ...(!input.rollbackDrill.restoredPriorSafeState ? ['rollback drill did not restore prior safe state'] : []),
        ...(input.rollbackDrill.usedDirectRuntimeJsonEdit ? ['rollback drill used direct runtime JSON edit'] : []),
        ...(input.rollbackDrill.retryCount !== 1 ? [`rollback retry count ${input.rollbackDrill.retryCount}`] : []),
        ...(input.healthyReplay.unexpectedTripCount !== 0 ? [`healthy replay unexpected trips ${input.healthyReplay.unexpectedTripCount}`] : []),
        ...(input.healthyReplay.queueOnlyResidencyCount !== 0 ? [`healthy replay queue-only residency ${input.healthyReplay.queueOnlyResidencyCount}`] : []),
        ...(!input.injectedFailureReplay.trippedQueueOnly ? ['injected failure did not trip queue-only'] : []),
        ...(!input.injectedFailureReplay.resetRequiresNewerPassingDigest ? ['reset does not require newer passing digest'] : []),
        ...(dispositionSummary.lackingUniqueConsumer.length > 0
            ? [`backlog items lacking unique consumer: ${dispositionSummary.lackingUniqueConsumer.join(', ')}`]
            : [])
    ];
    const withoutDigest = {
        schemaId: 'atm.plan3ClosureObservation.v1',
        parity: {
            equivalent: parityEquivalent,
            digests: {
                source: input.sourceObservationDigest,
                frozen: input.frozenObservationDigest,
                packageDist: input.packageDistObservationDigest,
                releaseProjection: input.releaseProjectionObservationDigest
            }
        },
        dispositionSummary,
        rollbackExercised: input.rollbackDrill.exercised && input.rollbackDrill.restoredPriorSafeState && !input.rollbackDrill.usedDirectRuntimeJsonEdit,
        rollbackExactlyOnceOnRetry: input.rollbackDrill.retryCount === 1,
        healthyReplayUnexpectedTrips: input.healthyReplay.unexpectedTripCount,
        healthyReplayQueueOnlyResidency: input.healthyReplay.queueOnlyResidencyCount,
        injectedFailureTripsQueueOnly: input.injectedFailureReplay.trippedQueueOnly,
        resetRequiresNewerPassingDigest: input.injectedFailureReplay.resetRequiresNewerPassingDigest,
        openBlockerIds: dispositionSummary.openBlockerIds,
        readinessProbeFailures
    };
    return {
        ...withoutDigest,
        digest: `sha256:${createHash('sha256').update(JSON.stringify(withoutDigest)).digest('hex')}`
    };
}
export function summarizeClosebackDisposition(items) {
    const counts = {
        inserted: 0,
        absorbedByExistingCard: 0,
        externalOwner: 0,
        deferredWithReason: 0,
        terminal: 0
    };
    const lackingUniqueConsumer = [];
    const openBlockerIds = [];
    for (const item of items) {
        switch (item.disposition) {
            case 'inserted':
                counts.inserted += 1;
                break;
            case 'absorbed-by-existing-card':
                counts.absorbedByExistingCard += 1;
                break;
            case 'external-owner':
                counts.externalOwner += 1;
                break;
            case 'deferred-with-reason':
                counts.deferredWithReason += 1;
                break;
            case 'terminal':
                counts.terminal += 1;
                break;
        }
        const hasConsumer = item.disposition === 'terminal'
            || Boolean(item.ownerCard?.trim())
            || Boolean(item.rationale?.trim());
        if (!hasConsumer)
            lackingUniqueConsumer.push(item.id);
        if (item.status === 'Open' && !hasConsumer)
            openBlockerIds.push(item.id);
    }
    return {
        schemaId: 'atm.plan3ClosebackDispositionSummary.v1',
        ...counts,
        lackingUniqueConsumer: lackingUniqueConsumer.sort(),
        openBlockerIds: openBlockerIds.sort()
    };
}
