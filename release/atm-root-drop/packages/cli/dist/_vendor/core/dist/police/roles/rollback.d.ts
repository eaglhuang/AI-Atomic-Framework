import type { RollbackPoliceInput, RollbackPoliceProposal, RollbackPoliceSignalKind, PoliceFamilyReport, PoliceFindingSeverity } from '../types.js';
export declare function runRollbackPolice(input?: RollbackPoliceInput): PoliceFamilyReport;
export declare function evaluateRollbackProposal(proposal: RollbackPoliceProposal): Array<{
    readonly trigger: RollbackPoliceSignalKind;
    readonly severity: PoliceFindingSeverity;
    readonly message: string;
}>;
