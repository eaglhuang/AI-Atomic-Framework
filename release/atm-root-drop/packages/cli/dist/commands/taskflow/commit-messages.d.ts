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
export declare const TASKFLOW_COMMIT_MESSAGE_STRATEGY: Record<TaskflowCommitMessageRole, TaskflowCommitMessageBuilder>;
export declare function buildTaskflowCommitMessage(role: TaskflowCommitMessageRole, input: TaskflowCommitMessageInput): string;
export {};
