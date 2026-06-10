export type TaskflowOpenerMode = 'delegated-governed' | 'template-only-fallback';
export interface TaskflowProfileV1 {
    schemaId: 'taskflow.profile.v1';
    id: string;
    name: string;
    repoLabel: string;
    ownerRepo: string;
    taskIdPrefix: string;
    taskId: {
        format: string;
    };
    template: {
        defaultMarkdown: string;
        namedTemplates?: Record<string, string>;
    };
    capabilities: {
        supportsDryRun: boolean;
        supportsWrite: boolean;
    };
    delegationDisplayHint?: string;
    delegation: {
        hint: string;
        openerPath?: string;
        policy?: {
            allocateTaskId?: {
                mode: 'host-opener' | 'fallback';
                prefix?: string;
                format?: string;
            };
            resolveCanonicalOutputPath?: {
                mode: 'host-opener' | 'fallback';
                pattern?: string;
                directory?: string;
            };
            rosterSyncPolicy?: 'inline' | 'follow-up-command' | 'none';
            rosterSync?: {
                indexPath?: string;
            };
            fallbackBehavior?: {
                mode: 'template-only-fallback' | 'governed-fallback';
                reason: string;
                missingPrerequisites?: string[];
            };
        };
        writerInvocation?: {
            describeOnly?: boolean;
            displayHint?: string;
        };
    };
}
export interface TaskflowDelegationContract {
    hostOpenerAvailable: boolean;
    openerPath: string | null;
    describeOnly: boolean;
    invocable: boolean;
    hint: string;
    displayHint: string | null;
    generationSurface: 'tasks-new';
    policy: {
        allocateTaskId: {
            mode: 'host-opener' | 'fallback';
            prefix: string | null;
            format: string | null;
        };
        resolveCanonicalOutputPath: {
            mode: 'host-opener' | 'fallback';
            pattern: string | null;
            directory: string | null;
        };
        rosterSyncPolicy: 'inline' | 'follow-up-command' | 'none';
        rosterSync: {
            indexPath: string | null;
        };
        fallbackBehavior: {
            mode: 'template-only-fallback' | 'governed-fallback';
            reason: string;
            missingPrerequisites: string[];
        };
    };
}
export interface TaskflowOpenDiagnostics {
    codes: string[];
    messages: string[];
    missingPrerequisites: string[];
}
export interface TaskflowWriteSupport {
    requested: boolean;
    allowed: boolean;
    reason: string;
}
export interface TaskflowOpenPrerequisiteInput {
    profile: TaskflowProfileV1 | null;
    taskIdSupplied: boolean;
    outputPathSupplied: boolean;
    writeRequested: boolean;
}
export declare function buildDelegationContract(profile: TaskflowProfileV1 | null): TaskflowDelegationContract;
export declare function collectMissingPrerequisites(input: TaskflowOpenPrerequisiteInput): string[];
export declare function canAutoResolveHostOpenerInputs(input: TaskflowOpenPrerequisiteInput): boolean;
export declare function resolveOpenerMode(input: TaskflowOpenPrerequisiteInput): TaskflowOpenerMode;
export declare function buildTaskflowOpenDiagnostics(input: TaskflowOpenPrerequisiteInput): TaskflowOpenDiagnostics;
export declare function resolveWriteSupport(input: TaskflowOpenPrerequisiteInput): TaskflowWriteSupport;
export declare function loadProfile(profilePath: string): TaskflowProfileV1;
