export function shouldEmitPromptWorktreeHint(hint) {
    if (!hint)
        return false;
    return hint.promptMatchedFiles.length > 0
        || hint.atmManagedFiles.length > 0
        || hint.generatedArtifactFiles.length > 0
        || hint.releaseMirrorFiles.length > 0
        || hint.unrelatedTrackedFiles.length > 0
        || hint.unrelatedUntrackedFiles.length > 0
        || hint.ignoredArtifactCount > 0;
}
