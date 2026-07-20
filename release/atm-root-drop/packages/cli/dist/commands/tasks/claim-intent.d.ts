export interface TaskClaimIntentResolution {
    readonly requestedClaimIntent: 'write' | 'closeout-only';
    readonly resolvedClaimIntent: 'write' | 'closeout-only';
    readonly autoIntent: boolean;
    readonly explicitClaimIntent: boolean;
    readonly reason: string;
    readonly dirtyInScopeFiles: readonly string[];
    readonly declaredDeliverableFiles: readonly string[];
    readonly deliverablesTrackedInHead: readonly string[];
    readonly missingDeliverables: readonly string[];
}
export declare function resolveTaskClaimIntent(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly taskDocument: Record<string, unknown>;
    readonly requestedClaimIntent: 'write' | 'closeout-only';
    readonly autoIntent: boolean;
    readonly explicitClaimIntent: boolean;
}): TaskClaimIntentResolution;
