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
}): RunnerBuildOutputInventory;
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
