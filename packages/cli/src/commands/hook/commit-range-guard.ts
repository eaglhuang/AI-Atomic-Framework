export { parseCommitRangeArgs } from './commit-range-guard/args.ts';
export type { ParsedCommitRangeArgs } from './commit-range-guard/args.ts';
export {
  createCommitRangeGuardReport,
  findFutureCommitEvidenceMatchInWorktree,
  readCurrentHeadForFutureCommit,
  readGitObjectText,
  readJsonText,
  readStagedTreeWithoutEvidence
} from './commit-range-guard/implementation.ts';
export { isAncestorCommit, isCommitAcceptedByLegacyBaseline, readFrameworkCommitRangeBaseline } from './commit-range-guard/baseline.ts';
export type { FrameworkCommitRangeBaseline } from './commit-range-guard/baseline.ts';
export { normalizeOptionalText } from './commit-range-guard/support.ts';
