type LegacyValue = ReturnType<typeof JSON.parse>;
export type CommitPathAuthorityDecision = {
    readonly schemaId: 'atm.commitPathAuthorityDecision.v1';
    readonly ok: boolean;
    readonly code: 'legacy-inspection' | 'claim-and-ticket-covered' | 'claim-not-active' | 'outside-active-claim' | 'outside-ticket-grant';
    readonly reason: string;
};
export type CommitAuthorityPolicy = {
    readonly evaluate: (filePath: string) => CommitPathAuthorityDecision;
};
export declare function createCommitAuthorityPolicy(input: LegacyValue): CommitAuthorityPolicy;
export {};
