export type PromptWorktreeHintLike = {
  readonly promptMatchedFiles: readonly string[];
  readonly atmManagedFiles: readonly string[];
  readonly generatedArtifactFiles: readonly string[];
  readonly releaseMirrorFiles: readonly string[];
  readonly unrelatedTrackedFiles: readonly string[];
  readonly unrelatedUntrackedFiles: readonly string[];
  readonly ignoredArtifactCount: number;
};

export function shouldEmitPromptWorktreeHint(hint: PromptWorktreeHintLike | null | undefined): boolean {
  if (!hint) return false;
  return hint.promptMatchedFiles.length > 0
    || hint.atmManagedFiles.length > 0
    || hint.generatedArtifactFiles.length > 0
    || hint.releaseMirrorFiles.length > 0
    || hint.unrelatedTrackedFiles.length > 0
    || hint.unrelatedUntrackedFiles.length > 0
    || hint.ignoredArtifactCount > 0;
}
