import type { TaskflowDelegationContract, TaskflowProfileV1 } from './profile-loader.ts';
export interface HostOpenerPolicyDecision {
    taskId: string;
    outputPath: string;
    sources: {
        taskId: 'explicit' | 'host-policy';
        outputPath: 'explicit' | 'host-policy';
    };
    diagnostics: string[];
    familyDrift: HostOpenerFamilyDrift | null;
}
export interface HostOpenerFamilyDrift {
    schemaId: 'atm.taskIdFamilyDrift.v1';
    status: 'clear' | 'duplicate-semantic-family';
    code: 'ATM_TASK_ID_FAMILY_DRIFT';
    requestedTaskId: string;
    requestedFamily: string;
    requestedSemanticKey: string;
    existingTaskId: string;
    existingFamily: string;
    existingPath: string;
    message: string;
}
export interface HostOpenerPolicyInput {
    cwd: string;
    profile: TaskflowProfileV1;
    delegationContract: TaskflowDelegationContract;
    taskId?: string | null;
    outputPath?: string | null;
    title?: string | null;
}
export declare function resolveHostOpenerPolicyDecision(input: HostOpenerPolicyInput): HostOpenerPolicyDecision;
export declare function canResolveHostOpenerPolicy(input: HostOpenerPolicyInput): boolean;
