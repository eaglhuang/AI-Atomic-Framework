import { type AdapterRegistry } from '../broker/adapters/index.ts';
import { type ConflictKey, type MutationRequest } from '../broker/types.ts';
import type { GitDiffEntry } from './diff-mutation-request.ts';
export interface GitDiffAdapterBridgeOptions {
    readonly cwd: string;
    readonly baseRef: string;
    readonly targetRef: string;
    readonly entries: readonly GitDiffEntry[];
    readonly actorId?: string;
    readonly taskId?: string | null;
    readonly registry?: AdapterRegistry;
    readonly gitExecutable?: string;
}
export interface GitDiffBridgeDiagnostic {
    readonly code: string;
    readonly message: string;
    readonly filePath: string;
    readonly action: 'inspect-json' | 'inspect-atom-map' | 'inspect-text-diff' | 'serialize-file';
}
export interface GitDiffBridgeResultEntry {
    readonly filePath: string;
    readonly adapterId: string;
    readonly conflictKeys: readonly ConflictKey[];
    readonly requests: readonly MutationRequest[];
    readonly diagnostics: readonly GitDiffBridgeDiagnostic[];
    readonly failClosed: boolean;
}
export interface GitDiffAdapterBridgeResult {
    readonly entries: readonly GitDiffBridgeResultEntry[];
    readonly diagnostics: readonly GitDiffBridgeDiagnostic[];
}
export declare function bridgeGitDiffEntriesToAdapterConflictKeys(input: GitDiffAdapterBridgeOptions): GitDiffAdapterBridgeResult;
