import type { AtomRefSweepOptions, AtomRefSweepResult, RepoReadabilityReport } from './atom-ref-readability/types.ts';
export type { AtomCallsiteRewrite, AtomCallsiteViolation, AtomRefSweepOptions, AtomRefSweepResult, RepoReadabilityReport } from './atom-ref-readability/types.ts';
export declare function sweepAtomRefReadability(options: AtomRefSweepOptions): AtomRefSweepResult;
export declare function validateAtomRefReadability(repoPath: string): RepoReadabilityReport;
