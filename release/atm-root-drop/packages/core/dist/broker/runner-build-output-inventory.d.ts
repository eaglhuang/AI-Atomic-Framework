export type RunnerBuildOutputDisposition = 'owned-current' | 'foreign-live' | 'stale-recovery-input' | 'unowned';
export interface RunnerBuildOutputInventoryEntry {
    readonly path: string;
    readonly disposition: RunnerBuildOutputDisposition;
    readonly ownerTaskId: string | null;
    readonly ownerActorId: string | null;
}
export interface RunnerBuildOutputInventory {
    readonly schemaId: 'atm.runnerBuildOutputInventory.v1';
    readonly sealedSourceSha: string;
    readonly entries: readonly RunnerBuildOutputInventoryEntry[];
    readonly digest: string;
}
export interface RunnerBuildOutputSnapshot {
    readonly schemaId: 'atm.runnerBuildOutputSnapshot.v1';
    readonly buildTarget: RunnerBuildOutputTarget;
    readonly members: Readonly<Record<string, string>>;
    readonly preexistingDirtyPaths: readonly string[];
}
/**
 * A queue-head approved replacement of pre-existing generated publication
 * bytes.  It is intentionally a plan, rather than a broad "force" switch:
 * every replacement stays bound to the sealed source and the exact bytes that
 * were observed before the build began.
 */
export interface RunnerPublicationTakeoverPlan {
    readonly schemaId: 'atm.runnerPublicationTakeoverPlan.v1';
    readonly sealedSourceSha: string;
    readonly snapshotDigest: string;
    readonly entries: readonly {
        readonly path: string;
        readonly observedDigest: string;
    }[];
    readonly digest: string;
}
export type RunnerPublicationDisposition = 'published' | 'publication-pending' | 'inventory-incomplete' | 'recovery-retained';
/**
 * The stable answer shared by doctor, runner-sync release, and publication.
 * Callers supply observed worktree state; this provider never runs Git or
 * selects a receipt on its own.
 */
export interface RunnerPublicationDispositionReport {
    readonly schemaId: 'atm.runnerPublicationDisposition.v1';
    readonly disposition: RunnerPublicationDisposition;
    readonly ok: boolean;
    readonly inventoryDigest: string;
    readonly dirtyInventoryPaths: readonly string[];
    readonly extraOutputPaths: readonly string[];
    readonly terminalDisposition: 'published' | 'recovery-retained' | null;
}
export interface RunnerBuildOutputInventoryValidation {
    readonly ok: boolean;
    readonly inventory: RunnerBuildOutputInventory | null;
    readonly reason: string | null;
}
export interface BuildOutputOwnership {
    readonly path: string;
    readonly ownerTaskId?: string | null;
    readonly ownerActorId?: string | null;
    readonly leaseFresh?: boolean | null;
}
export type RunnerBuildOutputTarget = 'full' | 'packages' | 'root-drop' | 'onefile';
/** The stable output family of a sealed ATM runner build. */
export declare function isRunnerBuildOutputPath(filePath: string): boolean;
/** Build artifacts whose unexpected dirty state must match a sealed inventory. */
export declare function isRunnerPublicationArtifactPath(filePath: string): boolean;
export declare function deriveRunnerBuildOutputInventory(input: {
    readonly sealedSourceSha: string;
    readonly observedPaths: readonly string[];
    readonly currentTaskId?: string | null;
    readonly ownership?: readonly BuildOutputOwnership[];
}): RunnerBuildOutputInventory;
/**
 * The sealed build adapter asks this module for publication membership. It does
 * not infer it from a dirty Git diff, which may contain another lane's work.
 */
export declare function scanSealedRunnerBuildOutputInventory(input: {
    readonly cwd: string;
    readonly buildTarget: RunnerBuildOutputTarget;
    readonly sealedSourceSha: string;
    readonly taskId: string | null;
    readonly beforeBuildSnapshot: RunnerBuildOutputSnapshot;
    /** A queue-head sealed build owns the publication roots it has admitted. */
    readonly includeDirtyPublicationMembers?: boolean;
    /**
     * Pre-existing output bytes become current-task owned only after the
     * publication boundary has validated an exact digest-bound takeover plan.
     */
    readonly takeoverPaths?: readonly string[];
}): RunnerBuildOutputInventory;
/** Capture byte identities before a sealed build mutates its output surfaces. */
export declare function captureRunnerBuildOutputSnapshot(input: {
    readonly cwd: string;
    readonly buildTarget: RunnerBuildOutputTarget;
    readonly currentTaskId?: string | null;
    readonly currentTaskAllowedFiles?: readonly string[];
}): RunnerBuildOutputSnapshot;
/** Create the immutable payload a broker must persist before a takeover. */
export declare function planRunnerPublicationTakeover(input: {
    readonly sealedSourceSha: string;
    readonly snapshot: RunnerBuildOutputSnapshot;
}): RunnerPublicationTakeoverPlan;
/** Reject stale, broadened, or hand-edited takeovers before any bytes move. */
export declare function validateRunnerPublicationTakeoverPlan(input: {
    readonly plan: unknown;
    readonly sealedSourceSha: string;
    readonly snapshot: RunnerBuildOutputSnapshot;
}): {
    readonly ok: boolean;
    readonly plan: RunnerPublicationTakeoverPlan | null;
    readonly reason: string | null;
};
export declare function buildRunnerBuildOutputInventory(input: {
    readonly sealedSourceSha: string;
    readonly outputPaths: readonly string[];
    readonly currentTaskId?: string | null;
    readonly ownership?: readonly BuildOutputOwnership[];
}): RunnerBuildOutputInventory;
export declare function inventoryPathsForPublication(inventory: RunnerBuildOutputInventory): readonly string[];
export declare function inventoryRecoveryBlockers(inventory: RunnerBuildOutputInventory): readonly RunnerBuildOutputInventoryEntry[];
export declare function evaluateRunnerPublicationDisposition(input: {
    readonly inventory: RunnerBuildOutputInventory;
    readonly dirtyPaths: readonly string[];
    /** A receipt-backed recovery transaction may intentionally retain exact members. */
    readonly terminalDisposition?: 'published' | 'recovery-retained' | null;
}): RunnerPublicationDispositionReport;
export declare function pathMatchesScope(filePath: string, allowedFiles: readonly string[]): boolean;
export declare function verifyRunnerBuildOutputParity(inventory: RunnerBuildOutputInventory, declaredPaths: readonly string[]): {
    readonly ok: boolean;
    readonly missing: readonly string[];
    readonly extra: readonly string[];
};
/**
 * Validate a receipt-provided inventory against the same canonical digest used
 * by the build writer. Consumers must not accept a merely shape-compatible
 * inventory, because it could describe a different sealed generation.
 */
export declare function validateRunnerBuildOutputInventory(value: unknown): RunnerBuildOutputInventoryValidation;
