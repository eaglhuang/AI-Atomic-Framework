type LegacyValue = ReturnType<typeof JSON.parse>;
export declare function resolveActorGitIdentityForCommit(cwd: LegacyValue, actorId: LegacyValue): {
    gitName: any;
    gitEmail: any;
};
export declare function evaluateGitGovernanceCheck(input: LegacyValue): {
    ok: boolean;
    actorId: string;
    taskId: any;
    claimLeaseId: any;
    sessionId: string | null;
    gitName: string | null;
    gitEmail: string | null;
    trailers: any;
    violations: {
        code: string;
        detail: string;
    }[];
};
export declare function runGitPrepare(options: LegacyValue): import("../../shared.ts").CommandResult;
export declare function runGitCommitStatus(options: LegacyValue): import("../../shared.ts").CommandResult;
export declare function requireExplicitGitActor(resolvedActor: LegacyValue, action: LegacyValue): void;
export declare function resolveGitIdentityProfile(cwd: LegacyValue, actorId: LegacyValue, actorRecord: LegacyValue, overrides?: LegacyValue): {
    gitName: any;
    gitEmail: any;
};
export declare function writePreparedRuntimeIdentity(cwd: LegacyValue, actorId: LegacyValue, gitName: LegacyValue, gitEmail: LegacyValue, actorRecord: LegacyValue): string;
export declare function buildIdentitySetRequiredCommand(cwd: LegacyValue, actorId: LegacyValue): string;
export declare function readTaskDocument(cwd: LegacyValue, taskId: LegacyValue): any;
export declare function parseTaskClaim(value: LegacyValue): {
    laneSession?: {
        laneSessionId: string | null;
    } | undefined;
    actorId: any;
    leaseId: any;
    state: any;
} | null;
export declare function resolveGitGovernanceSession(cwd: LegacyValue, input: LegacyValue): import("../../actor-session.ts").ActorWorkSessionDocument | null;
export { readGitConfig, writeGitConfig } from './git-config-port.ts';
export declare function parseTrailers(commitMessage: LegacyValue): any;
export declare function requireTrailerValue(trailers: LegacyValue, key: LegacyValue, expectedValue: LegacyValue, violations: LegacyValue, code: LegacyValue): void;
