/**
 * A task identifier fixes the candidate boundary. WIP relaxes session-trailer
 * requirements only; it cannot turn a task commit into a framework commit.
 */
export function resolveTaskBoundCommitFiles(input) {
    return input.taskId !== null && input.taskDocument
        ? input.taskScopedBundleReport?.commitFiles ?? []
        : input.frameworkClaimCommitFiles;
}
