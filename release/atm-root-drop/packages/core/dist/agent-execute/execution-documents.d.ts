export interface ValidationPassRecord {
    reportPath: string;
}
interface PromptDocumentRecord {
    promptPath: string;
    allowedFiles: string[];
    validationCommands: string[];
}
interface AgentOutcomeRecord {
    proposedChanges: unknown[];
    touchedFiles: string[];
    summary: string;
    logLines: string[];
}
interface ApplyOutcomeRecord {
    appliedChanges: boolean;
    touchedFiles: string[];
    summary: string;
}
interface ArtifactTargetsRecord {
    snapshotPath: string;
    logPath: string;
    evidencePath: string;
}
interface ExecutionEvidenceContext {
    atomId?: string;
    lifecycleMode: string;
    executionMode: string;
    ok?: boolean;
    generatedAt?: string;
    artifactTargets?: ArtifactTargetsRecord;
    effectNode?: unknown;
    promptDocument?: PromptDocumentRecord;
    agentOutcome: AgentOutcomeRecord;
    applyOutcome?: ApplyOutcomeRecord;
    validationPasses: ValidationPassRecord[];
    logLines?: string[];
}
export declare function createExecutionEvidenceDocument(context: ExecutionEvidenceContext): {
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
    validationPasses: ValidationPassRecord[];
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
export declare function createExecutionSnapshotDocument(context: ExecutionEvidenceContext): {
    atomId: string;
    lifecycleMode: string;
    executionMode: string;
    generatedAt: string;
    promptPath: string;
    summary: string;
    proposedChanges: unknown[];
    validationPasses: ValidationPassRecord[];
    effectNode: unknown;
};
export declare function createLogLines(context: ExecutionEvidenceContext): string[];
export {};
