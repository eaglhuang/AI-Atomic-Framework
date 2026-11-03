import { type DerivedBasisIdentity, type WaveExitObserverDiagnostic, type WaveExitObserverPolicy, type WaveExitObserverReceipt } from './wave-exit-observer-receipt.js';
export declare const WAVE_EXIT_OBSERVER_WRITE_COMMAND = "evidence wave-exit-observer";
export type WaveExitObserverWriteCode = 'ATM_WAVE_EXIT_OBSERVER_EXIT_UNMAPPED' | 'ATM_WAVE_EXIT_OBSERVER_UNAPPROVED_COMMAND' | 'ATM_WAVE_EXIT_OBSERVER_ROLE_MISMATCH' | 'ATM_WAVE_EXIT_OBSERVER_ACTOR_CONFLICT' | 'ATM_WAVE_EXIT_OBSERVER_DIGEST_DRIFT' | 'ATM_WAVE_EXIT_OBSERVER_HEAD_UNREACHABLE' | 'ATM_WAVE_EXIT_OBSERVER_RECEIPT_EXISTS' | 'ATM_WAVE_EXIT_OBSERVER_PATH_TRAVERSAL' | 'ATM_WAVE_EXIT_OBSERVER_FORBIDDEN_SURFACE' | 'ATM_WAVE_EXIT_OBSERVER_CALLER_OVERRIDE' | 'ATM_WAVE_EXIT_OBSERVER_FORBIDDEN_FLAG' | 'ATM_WAVE_EXIT_OBSERVER_CONSUME_UNPROVEN' | 'ATM_WAVE_EXIT_OBSERVER_NONZERO_EXIT' | 'ATM_WAVE_EXIT_OBSERVER_BASIS_UNRESOLVED';
export declare class WaveExitObserverWriteError extends Error {
    readonly code: WaveExitObserverWriteCode;
    readonly diagnostics: readonly WaveExitObserverDiagnostic[];
    readonly details: Record<string, unknown>;
    constructor(code: WaveExitObserverWriteCode, message: string, options?: {
        diagnostics?: readonly WaveExitObserverDiagnostic[];
        details?: Record<string, unknown>;
    });
}
export interface ObservedCommandResult {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
}
export interface WriteWaveExitObserverReceiptInput {
    readonly repoRoot: string;
    readonly exitItemId: string;
    readonly observerActor: string;
    readonly observerRole: string;
    readonly claimedCommand?: string | null;
    readonly claimedArtifactPath?: string | null;
    readonly claimedBasisActor?: string | null;
    readonly claimedInputDigests?: Readonly<Record<string, string>> | null;
    readonly extraFlags?: readonly string[];
    readonly policy: WaveExitObserverPolicy;
    readonly observedHead: string;
    readonly observedAt: string;
    readonly derivedBasis: DerivedBasisIdentity;
    readonly isAncestor: (ancestor: string, descendant: string) => boolean;
    readonly readObservedInput: (relativePath: string) => string | null;
    readonly executeApprovedCommand: (command: string) => ObservedCommandResult;
    readonly receiptExists?: (absolutePath: string) => boolean;
    readonly readExistingReceipt?: (absolutePath: string) => unknown | null;
    readonly createExclusiveFile?: (absolutePath: string, contents: string) => void;
}
export interface WriteWaveExitObserverReceiptResult {
    readonly ok: true;
    readonly receipt: WaveExitObserverReceipt;
    readonly artifactPath: string;
    readonly absolutePath: string;
}
export declare function deriveBasisActorsFromEvidenceOwners(repoRoot: string, owners: readonly string[]): string[];
export declare function exclusiveAtomicCreate(dest: string, contents: string): void;
export declare function writeWaveExitObserverReceipt(input: WriteWaveExitObserverReceiptInput): WriteWaveExitObserverReceiptResult;
