export * from './execution-constants.ts';
export declare function createExecuteAgentTaskEffectContract(options: any): {
    nodeKind: string;
    nodeName: string;
    defaultMode: string;
    applyFlag: string;
    proposalDelegatedTo: string;
};
export declare function executeAgentTask(normalizedModel: any, options: any): {
    ok: boolean;
    atomId: any;
    lifecycleMode: string;
    executionMode: string;
    promptPath: string;
    artifactPath: string;
    logPath: string;
    evidencePath: string;
    validationPasses: {
        passId: any;
        fixtureSet: any;
        ok: boolean;
        exitCode: any;
        reportPath: string;
        summary: string;
    }[];
    document: {
        schemaId: string;
        specVersion: string;
        migration: Readonly<{
            strategy: "additive";
            fromVersion: null;
            notes: "Initial ExecuteAgentTask effect node evidence contract.";
        }>;
        atomId: any;
        lifecycleMode: any;
        executionMode: any;
        ok: any;
        generatedAt: any;
        evidencePath: any;
        effectNode: any;
        prompt: {
            promptPath: any;
            allowedFiles: any;
            validationCommands: any;
        };
        agentRun: {
            proposedChangeCount: any;
            appliedChanges: boolean;
            hostProjectMutated: boolean;
            touchedFiles: any;
            appliedTouchedFiles: any;
            summary: any;
            artifactPath: any;
            logPath: any;
        };
        validationPasses: any;
        logSummary: {
            lineCount: any;
            preview: any;
            warningCount: any;
            errorCount: any;
        };
        artifacts: any[];
    };
    snapshotDocument: {
        atomId: any;
        lifecycleMode: any;
        executionMode: any;
        generatedAt: any;
        promptPath: any;
        summary: any;
        proposedChanges: any;
        validationPasses: any;
        effectNode: any;
    };
};
