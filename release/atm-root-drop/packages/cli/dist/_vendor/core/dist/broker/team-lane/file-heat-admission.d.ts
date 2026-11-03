import { type FileHeatMode, type FileHeatReceipt } from '../file-heat.js';
export interface TeamFileHeatOptions {
    readonly fileHeatPath?: string;
    readonly fileHeatMode?: FileHeatMode;
    /** Read the heat ledger without recording touches (ATM_HEAT_FREEZE=1), for replay-stable runs. */
    readonly fileHeatFrozen?: boolean;
    readonly now?: Date;
}
export declare function normalizeTeamTargetFiles(writePaths: readonly string[]): string[];
/** Hot files follow the heat receipt when supplied, otherwise the static basename set. */
export declare function selectTeamHotFiles(targetFiles: readonly string[], fileHeat?: FileHeatReceipt): string[];
/** Records this intent's touches (unless read-only or frozen) and returns the heat receipt used for admission. */
export declare function evaluateTeamFileHeat(input: TeamFileHeatOptions & {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly writePaths: readonly string[];
    readonly readOnly?: boolean;
}): FileHeatReceipt;
