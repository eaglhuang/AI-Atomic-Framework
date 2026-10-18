export interface ComposeMemberInput {
    readonly proposalId: string;
    readonly arrivedAt: number;
    readonly baseBytes: string;
    readonly patch: string;
}
export interface ReadyMember {
    readonly proposalId: string;
    readonly arrivedAt: number;
    readonly declaredBase: string;
    readonly mine: string;
}
export type MemberComposeResult = {
    readonly ok: true;
    readonly content: string;
} | {
    readonly ok: false;
    readonly verdict: 'conflict' | 'error';
    readonly detail: string;
};
export interface RejectedMember {
    readonly proposalId: string;
    readonly detail: 'git-merge-conflict' | 'excluded-by-arrival-maximal-subset' | 'legal-proof-limit' | 'error';
    readonly errorDetail: string | null;
}
export interface SubsetSelection {
    readonly accepted: readonly ReadyMember[];
    readonly rejected: readonly RejectedMember[];
    readonly content: string | null;
}
export declare function gitMergeFileBytes(current: string, base: string, theirs: string): MemberComposeResult;
export declare function materializeMember(member: ComposeMemberInput): {
    readonly ok: true;
    readonly ready: ReadyMember;
} | {
    readonly ok: false;
    readonly detail: string;
};
/** Every order of git merge-file must be clean and byte-identical. */
export declare function proveOrderIndependentMerge(windowBase: string, members: readonly ReadyMember[]): MemberComposeResult;
/**
 * Greedy by arrival time, then proposal id. The result is inclusion-maximal
 * inside the exhaustive proof bound: every rejected member was tested against
 * the accepted set and was not a legal addition.
 */
export declare function selectArrivalOrderMaximalSubset(windowBase: string, members: readonly ReadyMember[]): SubsetSelection;
