/**
 * Per-file temperature from inter-arrival gaps between write intents (issue #184).
 *
 * Temperature only biases how often a path takes the hot (proposal-first) lane.
 * It never overrides true-conflict, lease, or CAS gates.
 */
export declare const DEFAULT_FILE_HEAT_RELATIVE_PATH = ".atm/runtime/file-heat.json";
export declare const LEGACY_HOT_FILE_BASENAMES: ReadonlySet<string>;
export declare const LEARNED_MODE_LEGACY_PRIOR = 65;
export declare const FILE_HEAT_POLICY_DIGEST = "file-heat.v1";
/** A touch that leaves T at or above this counts toward the sustained-hot streak. */
export declare const SUSTAINED_HOT_THRESHOLD = 90;
/** Streak length at which the receipt flags an experience-loop candidate for human review. */
export declare const EXPERIENCE_CANDIDATE_STREAK = 3;
export type FileHeatMode = 'static' | 'hybrid' | 'learned';
export interface FileHeatEntry {
    readonly temperature: number;
    readonly lastTouchAt: string;
    readonly lastActorId: string;
    /** Task of the last touch; re-evaluating one task under another actor label is not contention. */
    readonly lastTaskId?: string;
    /** Consecutive touches that left T >= SUSTAINED_HOT_THRESHOLD. */
    readonly hotStreak?: number;
}
export interface FileHeatLedger {
    readonly schemaId: 'atm.fileHeatLedger.v1';
    readonly specVersion: '0.1.0';
    readonly entries: Readonly<Record<string, FileHeatEntry>>;
}
export interface FileHeatFileReceipt {
    readonly path: string;
    /** Temperature that drives routing in the current mode. */
    readonly temperature: number;
    /** Learned inter-arrival temperature, reported in every mode so static rollouts still observe heat. */
    readonly observedTemperature: number;
    readonly pHot: number;
    readonly hot: boolean;
    /** True when the file stayed hot for EXPERIENCE_CANDIDATE_STREAK touches; review before promoting. */
    readonly experienceCandidate: boolean;
}
export interface FileHeatReceipt {
    readonly schemaId: 'atm.fileHeatReceipt.v1';
    readonly mode: FileHeatMode;
    readonly policyDigest: string;
    /** Frozen receipts read the ledger without recording touches, so replays stay stable. */
    readonly frozen: boolean;
    readonly files: readonly FileHeatFileReceipt[];
}
export interface FileHeatStatusEntry {
    readonly path: string;
    readonly temperature: number;
    readonly lastTouchAt: string;
    readonly lastActorId: string;
    readonly hotStreak: number;
}
/** Idle cool-down: nothing for the first minute, then T *= 0.9 per five idle minutes. */
export declare const COOL_IDLE_FLOOR_MS = 60000;
export declare const COOL_WINDOW_MS: number;
export declare const COOL_FACTOR_PER_WINDOW = 0.9;
export declare function createEmptyFileHeatLedger(): FileHeatLedger;
export declare function resolveFileHeatMode(value?: string | undefined): FileHeatMode;
export declare function resolveFileHeatFrozen(value?: string | undefined): boolean;
export declare function heatBumpForGap(deltaMs: number): number;
export declare function coolTemperature(temperature: number, idleMs: number): number;
export declare function clampTemperature(value: number): number;
/**
 * Record one write-intent touch. Heat rises only when the previous touch came from a
 * different actor on a different task; a single actor saving rapidly, or one task
 * re-evaluated under another actor label, stays on the cold path.
 */
export declare function recordFileTouch(ledger: FileHeatLedger, input: {
    readonly path: string;
    readonly actorId: string;
    readonly taskId?: string;
    readonly now: Date;
}): FileHeatLedger;
/** Files ordered hottest first, after idle cool-down, for doctor / status views. */
export declare function listHottestFiles(ledger: FileHeatLedger, now: Date, limit?: number): FileHeatStatusEntry[];
/** Drop learned heat for the given paths, or for every path when none are given. */
export declare function resetFileHeat(ledger: FileHeatLedger, paths?: readonly string[]): {
    readonly ledger: FileHeatLedger;
    readonly removed: readonly string[];
};
/** Learned temperature as of `now`, after idle cool-down. */
export declare function readLearnedTemperature(ledger: FileHeatLedger, filePath: string, now: Date): number;
export declare function resolveEffectiveTemperature(input: {
    readonly mode: FileHeatMode;
    readonly ledger: FileHeatLedger;
    readonly path: string;
    readonly now: Date;
}): number;
/** Stable Bernoulli draw on p_hot = T / 100 so a given task/path/policy always routes the same way. */
export declare function decideHotPath(input: {
    readonly temperature: number;
    readonly taskId: string;
    readonly path: string;
    readonly policyDigest?: string;
}): boolean;
export declare function buildFileHeatReceipt(input: {
    readonly mode: FileHeatMode;
    readonly ledger: FileHeatLedger;
    readonly taskId: string;
    readonly paths: readonly string[];
    readonly now: Date;
    readonly frozen?: boolean;
}): FileHeatReceipt;
export declare function loadFileHeatLedger(ledgerPath: string): FileHeatLedger;
export declare function saveFileHeatLedger(ledgerPath: string, ledger: FileHeatLedger): void;
