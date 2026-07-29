export type ClosebackDisposition = 'inserted' | 'absorbed-by-existing-card' | 'external-owner' | 'deferred-with-reason' | 'terminal';
export interface ClosebackDispositionItem {
    readonly id: string;
    readonly disposition: ClosebackDisposition;
    readonly status: string;
    readonly ownerCard?: string | null;
    readonly rationale?: string | null;
}
export interface ClosebackDispositionSummary {
    readonly schemaId: 'atm.plan3ClosebackDispositionSummary.v1';
    readonly inserted: number;
    readonly absorbedByExistingCard: number;
    readonly externalOwner: number;
    readonly deferredWithReason: number;
    readonly terminal: number;
    readonly lackingUniqueConsumer: readonly string[];
    readonly openBlockerIds: readonly string[];
}
export interface ClosureObservationInput {
    readonly backlogItems: readonly ClosebackDispositionItem[];
    readonly sourceObservationDigest: string;
    readonly frozenObservationDigest: string;
    readonly packageDistObservationDigest: string;
    readonly releaseProjectionObservationDigest: string;
    readonly rollbackDrill: {
        readonly exercised: boolean;
        readonly restoredPriorSafeState: boolean;
        readonly usedDirectRuntimeJsonEdit: boolean;
        readonly retryCount: number;
    };
    readonly healthyReplay: {
        readonly unexpectedTripCount: number;
        readonly queueOnlyResidencyCount: number;
    };
    readonly injectedFailureReplay: {
        readonly trippedQueueOnly: boolean;
        readonly resetRequiresNewerPassingDigest: boolean;
    };
}
export interface ClosureObservation {
    readonly schemaId: 'atm.plan3ClosureObservation.v1';
    readonly parity: {
        readonly equivalent: boolean;
        readonly digests: {
            readonly source: string;
            readonly frozen: string;
            readonly packageDist: string;
            readonly releaseProjection: string;
        };
    };
    readonly dispositionSummary: ClosebackDispositionSummary;
    readonly rollbackExercised: boolean;
    readonly rollbackExactlyOnceOnRetry: boolean;
    readonly healthyReplayUnexpectedTrips: number;
    readonly healthyReplayQueueOnlyResidency: number;
    readonly injectedFailureTripsQueueOnly: boolean;
    readonly resetRequiresNewerPassingDigest: boolean;
    readonly openBlockerIds: readonly string[];
    readonly readinessProbeFailures: readonly string[];
    readonly digest: string;
}
export declare function buildClosureObservation(input: ClosureObservationInput): ClosureObservation;
export declare function summarizeClosebackDisposition(items: readonly ClosebackDispositionItem[]): ClosebackDispositionSummary;
