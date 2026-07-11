export type ClaimCommandShape = 'task-scoped' | 'prompt-scoped';
export interface TaskScopedClaimCommandContract {
    readonly schemaId: 'atm.nextTaskScopedClaimCommand.v1';
    readonly normalClaimCommand: string;
    readonly taskScopedClaimCommand: string;
    readonly claimCommandShape: ClaimCommandShape;
    readonly explicitTaskSelector: string | null;
}
export interface BuildTaskScopedClaimCommandInput {
    readonly selectedTaskId: string | null;
    readonly explicitTaskSelector: string | null;
    readonly userPrompt: string | null;
}
/**
 * Pure contract builder for TASK-CID-0073 task-scoped claim command fields.
 * Returns null when no selected task id is available.
 */
export declare function buildTaskScopedClaimCommand(input: BuildTaskScopedClaimCommandInput): TaskScopedClaimCommandContract | null;
