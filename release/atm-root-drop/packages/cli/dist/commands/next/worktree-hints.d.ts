export type PromptWorktreeHintLike = {
    readonly promptMatchedFiles: readonly string[];
    readonly atmManagedFiles: readonly string[];
    readonly generatedArtifactFiles: readonly string[];
    readonly releaseMirrorFiles: readonly string[];
    readonly unrelatedTrackedFiles: readonly string[];
    readonly unrelatedUntrackedFiles: readonly string[];
    readonly ignoredArtifactCount: number;
};
export declare function shouldEmitPromptWorktreeHint(hint: PromptWorktreeHintLike | null | undefined): boolean;
