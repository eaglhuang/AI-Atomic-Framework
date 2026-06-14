export type TaskflowCommitMessageRole = 'target' | 'planning';

export interface TaskflowCommitMessageProfile {
  delegation?: {
    policy?: {
      commitMessage?: {
        targetTemplate?: string;
        planningTemplate?: string;
      };
    };
  };
}

export interface TaskflowCommitMessageInput {
  taskId: string;
  profile?: TaskflowCommitMessageProfile | null;
}

type TaskflowCommitMessageBuilder = (input: TaskflowCommitMessageInput) => string;

export const TASKFLOW_COMMIT_MESSAGE_STRATEGY: Record<TaskflowCommitMessageRole, TaskflowCommitMessageBuilder> = {
  target: (input) => input.profile?.delegation?.policy?.commitMessage?.targetTemplate
    ?? `chore(taskflow): close ${input.taskId} target governance bundle`,
  planning: (input) => input.profile?.delegation?.policy?.commitMessage?.planningTemplate
    ?? `docs(taskflow): close ${input.taskId} planning bundle`
};

export function buildTaskflowCommitMessage(role: TaskflowCommitMessageRole, input: TaskflowCommitMessageInput): string {
  return TASKFLOW_COMMIT_MESSAGE_STRATEGY[role](input);
}
