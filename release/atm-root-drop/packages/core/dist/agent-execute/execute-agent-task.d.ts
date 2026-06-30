export * from './execution-constants.ts';
interface ExecuteAgentTaskModel {
    identity?: {
        atomId?: string;
    };
    execution?: {
        compatibility?: {
            lifecycleMode?: string;
        };
        validation?: {
            commands?: string[];
        };
    };
}
interface EffectContractRecord {
    nodeKind: string;
    nodeName: string;
    defaultMode: string;
    applyFlag: string;
    proposalDelegatedTo: string;
}
interface ExecuteAgentTaskOptions {
    repositoryRoot?: string;
    now?: string;
    applyChanges?: boolean;
    proposalDelegatedTo?: string;
    promptDocument?: unknown;
    prompt?: unknown;
    workbenchPath?: string;
    workbenchRoot?: string;
    snapshotFileName?: string;
    logFileName?: string;
    evidenceFileName?: string;
    reportDirName?: string;
    agentExecutor?: (context: Record<string, unknown>) => unknown;
    applyExecution?: (context: Record<string, unknown>) => unknown;
    runValidationPass?: (context: Record<string, unknown>) => unknown;
}
export declare function createExecuteAgentTaskEffectContract(options?: ExecuteAgentTaskOptions): EffectContractRecord;
export declare function executeAgentTask(normalizedModel: ExecuteAgentTaskModel, options?: ExecuteAgentTaskOptions): {
    ok: boolean;
    atomId: string;
    lifecycleMode: string;
    executionMode: string;
    promptPath: string;
    artifactPath: string;
    logPath: string;
    evidencePath: string;
    validationPasses: {
        passId: string;
        fixtureSet: string;
        ok: boolean;
        exitCode: number;
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
        atomId: string;
        lifecycleMode: string;
        executionMode: string;
        ok: boolean;
        generatedAt: string;
        evidencePath: string;
        effectNode: unknown;
        prompt: {
            promptPath: string;
            allowedFiles: string[];
            validationCommands: string[];
        };
        agentRun: {
            proposedChangeCount: number;
            appliedChanges: boolean;
            hostProjectMutated: boolean;
            touchedFiles: string[];
            appliedTouchedFiles: string[];
            summary: string;
            artifactPath: string;
            logPath: string;
        };
        validationPasses: import("./execution-documents.ts").ValidationPassRecord[];
        logSummary: {
            lineCount: number;
            preview: string[];
            warningCount: number;
            errorCount: number;
        };
        artifacts: {
            artifactPath: string;
            artifactKind: string;
            producedBy: string;
        }[];
    };
    snapshotDocument: {
        atomId: string;
        lifecycleMode: string;
        executionMode: string;
        generatedAt: string;
        promptPath: string;
        summary: string;
        proposedChanges: unknown[];
        validationPasses: import("./execution-documents.ts").ValidationPassRecord[];
        effectNode: unknown;
    };
};
