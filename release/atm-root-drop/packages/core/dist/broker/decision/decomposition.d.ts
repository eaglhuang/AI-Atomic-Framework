import type { ActiveWriteIntent, ConflictDetail, DecompositionRequest, DecompositionTargetFunction, LineRange, SuggestedSplitAtom, WriteIntent } from '../types.ts';
import { type VirtualAtomCandidate } from '../agr.ts';
export declare function toVirtualAtoms(intent: WriteIntent): VirtualAtomCandidate[];
export declare function toVirtualAtomRangesFromActiveIntent(intent: ActiveWriteIntent): VirtualAtomCandidate[];
export declare function buildLayer2ConflictDetail(region: LineRange): ConflictDetail;
export declare function buildDecompositionRequest(targetFunction: DecompositionTargetFunction, conflictRegion: LineRange, options?: {
    readonly suggestionKind?: DecompositionRequest['suggestionKind'];
    readonly ownerAtomId?: string | null;
    readonly rationale?: string;
    readonly containerRange?: LineRange;
}): DecompositionRequest;
export declare function maybeBuildCidConflictDecompositionRequest(newIntent: WriteIntent, activeIntents: readonly ActiveWriteIntent[]): DecompositionRequest | null;
export declare function buildSuggestedSplitAtoms(targetFunction: DecompositionTargetFunction, conflictRegion: LineRange, containerRangeOverride?: LineRange): readonly SuggestedSplitAtom[];
export declare function toSuggestedAtomCid(atomId: string, role: SuggestedSplitAtom['role'], range: LineRange): string;
