import type { BrokerDecision, ConflictKey, MutationRequest } from '../broker/types.ts';
import { type GitBranchTopologySnapshot, type GitDiffEntry, type GitDiffMutationRequestOptions } from './diff-mutation-request.ts';
import { type GitDiffBridgeDiagnostic } from './format-adapter-bridge.ts';
export type GitAdmissionOutcome = 'allow' | 'block' | 'composer-routed' | 'no-op' | 'internal-error';
export interface GitAdmissionOptions extends GitDiffMutationRequestOptions {
    readonly registryPath?: string;
}
export interface GitAdmissionSideSummary {
    readonly diff: readonly GitDiffEntry[];
    readonly requests: readonly MutationRequest[];
    readonly bridged: readonly GitAdmissionBridgeEntry[];
}
export interface GitAdmissionBridgeEntry {
    readonly filePath: string;
    readonly adapterId: string;
    readonly conflictKeys: readonly ConflictKey[];
    readonly requests: readonly MutationRequest[];
    readonly diagnostics: readonly GitDiffBridgeDiagnostic[];
    readonly failClosed: boolean;
}
export interface GitAdmissionResult {
    readonly outcome: GitAdmissionOutcome;
    readonly topology: GitBranchTopologySnapshot;
    readonly brokerDecision: BrokerDecision | null;
    readonly brokerRegistryPath: string;
    readonly conflictingFiles: readonly string[];
    readonly recommendedNextStep: string;
    readonly local: GitAdmissionSideSummary;
    readonly remote: GitAdmissionSideSummary;
    readonly diagnostics: readonly GitDiffBridgeDiagnostic[];
}
export declare function evaluateGitAdmission(input: GitAdmissionOptions): GitAdmissionResult;
