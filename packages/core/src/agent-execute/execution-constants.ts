export const defaultExecutionEvidenceSchemaId = 'atm.executionEvidence';
export const defaultExecutionEvidenceFileName = 'execution-evidence.json';
export const defaultExecutionSnapshotFileName = 'agent-execute.snapshot.json';
export const defaultExecutionLogFileName = 'agent-execute.log';
export const defaultExecutionReportDirName = 'execution-reports';
export const defaultExecutionWorkbenchRoot = 'atomic_workbench/atoms';
export const defaultExecutionProducer = '@ai-atomic-framework/core:execute-agent-task';
export const executeAgentTaskNodeKind = 'effect';
export const executeAgentTaskNodeName = 'ExecuteAgentTask';
export const executeAgentTaskApplyFlag = '--apply';
export const defaultProposalDelegatedTo = 'ATM-2-0020';
export const defaultExecutionEvidenceMigration = Object.freeze({
  strategy: 'additive',
  fromVersion: null,
  notes: 'Initial ExecuteAgentTask effect node evidence contract.'
});
