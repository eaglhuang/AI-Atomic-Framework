import { type EmergencyUseEvidence } from '../../tasks.ts';
export declare function authorizeCloseRunnerRecovery(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly allowStaleRunner: boolean;
    readonly emergencyApproval: string | null;
    readonly reason: string | null;
}): Promise<EmergencyUseEvidence>;
