import { collectGitDiffMutationRequests, type GitDiffMutationRequestEnvelope, type GitDiffMutationRequestOptions } from '../../../core/src/git/index.ts';

export function resolveGitDiffMutationRequests(options: GitDiffMutationRequestOptions): GitDiffMutationRequestEnvelope {
  return collectGitDiffMutationRequests(options);
}
