import type { TaskflowDelegationContract, TaskflowProfileV1 } from './profile-loader.ts';
export interface HostOpenerPolicyDecision {
    taskId: string;
    outputPath: string;
    sources: {
        taskId: 'explicit' | 'host-policy';
        outputPath: 'explicit' | 'host-policy';
    };
    diagnostics: string[];
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
