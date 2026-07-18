export interface ParsedCommitRangeArgs {
    readonly cwd: string;
    readonly base: string;
    readonly head: string;
}
export declare function parseCommitRangeArgs(argv: string[]): ParsedCommitRangeArgs;
