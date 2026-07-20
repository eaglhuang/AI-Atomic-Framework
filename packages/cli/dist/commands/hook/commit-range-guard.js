export { parseCommitRangeArgs } from './commit-range-guard/args.js';
export { createCommitRangeGuardReport, findFutureCommitEvidenceMatchInWorktree, readCurrentHeadForFutureCommit, readGitObjectText, readJsonText, readStagedTreeWithoutEvidence } from './commit-range-guard/implementation.js';
export { isAncestorCommit, isCommitAcceptedByLegacyBaseline, readFrameworkCommitRangeBaseline } from './commit-range-guard/baseline.js';
export { normalizeOptionalText } from './commit-range-guard/support.js';
