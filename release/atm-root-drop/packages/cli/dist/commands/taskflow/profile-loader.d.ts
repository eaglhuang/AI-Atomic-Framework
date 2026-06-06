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
        writerInvocation?: {
            describeOnly?: boolean;
            displayHint?: string;
        };
    };
}
export declare function loadProfile(profilePath: string): TaskflowProfileV1;
