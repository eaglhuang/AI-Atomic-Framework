import { type CommandResult } from '../shared.ts';
export type RealignPathMapping = {
    readonly from: string;
    readonly to: string;
};
export type RealignPlanSourceOptions = {
    readonly cwd: string;
    readonly mapPath: string;
    readonly dryRun: boolean;
    readonly write: boolean;
    readonly actorId: string | null;
    readonly planningRepoRoot: string | null;
    readonly json: boolean;
};
export type RealignProposal = {
    readonly taskId: string;
    readonly taskPath: string;
    readonly previousPlanPath: string;
    readonly nextPlanPath: string;
    readonly previousSealTaskCardPath: string | null;
    readonly nextSealTaskCardPath: string;
    readonly contentDigest: string;
    readonly protectedFieldsUnchanged: readonly string[];
    readonly decision: 'realign' | 'refuse-digest-mismatch' | 'skip-no-mapping' | 'skip-not-closed';
    readonly reason: string;
};
export declare function parseRealignMapFile(mapPath: string): readonly RealignPathMapping[];
export declare function parseRealignPlanSourceArgv(argv: readonly string[]): RealignPlanSourceOptions;
export declare function buildRealignProposals(input: {
    readonly cwd: string;
    readonly mappings: readonly RealignPathMapping[];
    readonly planningRepoRoot?: string | null;
}): readonly RealignProposal[];
export declare function assertCommitContainsPaths(input: {
    readonly cwd: string;
    readonly commitSha: string;
    readonly expectedPaths: readonly string[];
}): void;
export declare function runTasksRealignPlanSource(argv: string[]): Promise<CommandResult>;
export declare const REALIGN_PROTECTED_LIFECYCLE_FIELDS: readonly ["status", "closedAt", "closurePacket", "owner", "claim", "taskDirectionLock"];
