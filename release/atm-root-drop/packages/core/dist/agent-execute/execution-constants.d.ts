export declare const defaultExecutionEvidenceSchemaId = "atm.executionEvidence";
export declare const defaultExecutionEvidenceFileName = "execution-evidence.json";
export declare const defaultExecutionSnapshotFileName = "agent-execute.snapshot.json";
export declare const defaultExecutionLogFileName = "agent-execute.log";
export declare const defaultExecutionReportDirName = "execution-reports";
export declare const defaultExecutionWorkbenchRoot = "atomic_workbench/atoms";
export declare const defaultExecutionProducer = "@ai-atomic-framework/core:execute-agent-task";
export declare const executeAgentTaskNodeKind = "effect";
export declare const executeAgentTaskNodeName = "ExecuteAgentTask";
export declare const executeAgentTaskApplyFlag = "--apply";
export declare const defaultProposalDelegatedTo = "ATM-2-0020";
export declare const defaultExecutionEvidenceMigration: Readonly<{
    strategy: "additive";
    fromVersion: null;
    notes: "Initial ExecuteAgentTask effect node evidence contract.";
}>;
