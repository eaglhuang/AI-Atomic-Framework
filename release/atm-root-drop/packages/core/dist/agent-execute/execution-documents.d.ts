export declare function createExecutionEvidenceDocument(context: any): {
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
export declare function createExecutionSnapshotDocument(context: any): {
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
export declare function createLogLines(context: any): any[];
