export type BrokerQueueAdmission = {
    readonly schemaId: 'atm.brokerQueueAdmission.v1';
    readonly taskId: string;
    readonly status: 'not-queued' | 'queue-head' | 'queued-private-work' | 'queued-blocked' | 'invalid';
    readonly allowedFiles: readonly string[];
    readonly queuedSharedPaths: readonly string[];
    readonly waitingOn: readonly {
        readonly surfacePath: string;
        readonly queueHeadTaskId: string;
        readonly position: number;
    }[];
    readonly reason: string;
};
export declare function evaluateBrokerQueueAdmission(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly allowedFiles: readonly string[];
    readonly overlappingFiles: readonly string[];
}): BrokerQueueAdmission;
export type TeamQueueScopeDecision = {
    readonly schemaId: 'atm.teamQueueScopeDecision.v1';
    readonly verdict: 'unrestricted' | 'restricted-private-work' | 'rejected';
    readonly writePaths: readonly string[];
    readonly queuedSharedPaths: readonly string[];
    readonly reason: string;
};
/**
 * TASK-TEAM-0078 — project a team plan/start write scope through the
 * canonical shared-surface queue admission. `queued-private-work` restricts
 * the role write scope to the disjoint private paths; `queued-blocked` and
 * `invalid` reject the run. The projection never widens the input scope.
 */
export declare function restrictTeamWriteScopeForQueueAdmission(admission: BrokerQueueAdmission, writePaths: readonly string[]): TeamQueueScopeDecision;
