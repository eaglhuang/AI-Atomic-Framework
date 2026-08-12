import type { PreCommitBlockingFinding } from './support.ts';
/** Adapts team runtime policy into the pre-commit failure envelope. */
export declare function buildTeamGateFindings(cwd: string, stagedFiles: readonly string[]): PreCommitBlockingFinding[];
