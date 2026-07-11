import type { DecompositionPoliceInput, PoliceFamilyReport, PoliceFinding } from '../types.ts';
export declare function runDecompositionPolice(input?: DecompositionPoliceInput): PoliceFamilyReport;
export declare function buildDecompositionPlanHintDraft(finding: PoliceFinding): {
    readonly ok: boolean;
    readonly errors: readonly string[];
    readonly draft?: {
        readonly schemaId: 'atm.decompositionPlanDraft';
        readonly specVersion: '0.1.0';
        readonly mode: 'draft';
        readonly legacyUris: readonly string[];
        readonly proposedMembers: readonly string[];
        readonly entrypoints: readonly string[];
    };
};
