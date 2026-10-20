import { type AtomRefSweepOptions, type AtomRefSweepResult, type RepoReadabilityReport } from './atom-ref-readability/types.js';
export type { AtomCallsiteRewrite, AtomCallsiteViolation, AtomRefSweepOptions, AtomRefSweepResult, RepoReadabilityReport } from './atom-ref-readability/types.js';
export declare function sweepAtomRefReadability(options: AtomRefSweepOptions): AtomRefSweepResult;
export declare function validateAtomRefReadability(repoPath: string): RepoReadabilityReport;
