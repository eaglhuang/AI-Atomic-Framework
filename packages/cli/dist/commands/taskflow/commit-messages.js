export const TASKFLOW_COMMIT_MESSAGE_STRATEGY = {
    target: (input) => input.profile?.delegation?.policy?.commitMessage?.targetTemplate
        ?? `chore(taskflow): close ${input.taskId} target governance bundle`,
    planning: (input) => input.profile?.delegation?.policy?.commitMessage?.planningTemplate
        ?? `docs(taskflow): close ${input.taskId} planning bundle`
};
export function buildTaskflowCommitMessage(role, input) {
    return TASKFLOW_COMMIT_MESSAGE_STRATEGY[role](input);
}
