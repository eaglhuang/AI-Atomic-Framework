import {
  defaultExecutionEvidenceMigration,
  defaultExecutionEvidenceSchemaId,
  defaultExecutionProducer
} from './execution-constants.ts';

export function createExecutionEvidenceDocument(context) {
  const logSummary = createLogSummary(context.logLines);
  const artifacts = [
    createArtifactRecord(context.artifactTargets.snapshotPath, 'snapshot'),
    createArtifactRecord(context.artifactTargets.logPath, 'log'),
    createArtifactRecord(context.artifactTargets.evidencePath, 'report'),
    ...context.validationPasses.map((pass) => createArtifactRecord(pass.reportPath, 'report'))
  ];

  return {
    schemaId: defaultExecutionEvidenceSchemaId,
    specVersion: '0.1.0',
    migration: defaultExecutionEvidenceMigration,
    atomId: context.atomId,
    lifecycleMode: context.lifecycleMode,
    executionMode: context.executionMode,
    ok: context.ok,
    generatedAt: context.generatedAt,
    evidencePath: context.artifactTargets.evidencePath,
    effectNode: context.effectNode,
    prompt: {
      promptPath: context.promptDocument.promptPath,
      allowedFiles: context.promptDocument.allowedFiles,
      validationCommands: context.promptDocument.validationCommands
    },
    agentRun: {
      proposedChangeCount: context.agentOutcome.proposedChanges.length,
      appliedChanges: context.applyOutcome.appliedChanges === true,
      hostProjectMutated: context.applyOutcome.appliedChanges === true,
      touchedFiles: context.agentOutcome.touchedFiles,
      appliedTouchedFiles: context.applyOutcome.touchedFiles,
      summary: context.executionMode === 'dry-run'
        ? context.agentOutcome.summary
        : context.applyOutcome.summary || context.agentOutcome.summary,
      artifactPath: context.artifactTargets.snapshotPath,
      logPath: context.artifactTargets.logPath
    },
    validationPasses: context.validationPasses,
    logSummary,
    artifacts
  };
}

export function createExecutionSnapshotDocument(context) {
  return {
    atomId: context.atomId,
    lifecycleMode: context.lifecycleMode,
    executionMode: context.executionMode,
    generatedAt: context.generatedAt,
    promptPath: context.promptDocument.promptPath,
    summary: context.agentOutcome.summary,
    proposedChanges: context.agentOutcome.proposedChanges,
    validationPasses: context.validationPasses,
    effectNode: context.effectNode
  };
}

export function createLogLines(context) {
  const lines = [...context.agentOutcome.logLines];
  const validationSummary = context.lifecycleMode === 'evolution'
    ? 'VALIDATION: baseline + candidate fixture passes recorded'
    : 'VALIDATION: current fixture pass recorded';
  lines.push(validationSummary);
  if (context.executionMode === 'apply') {
    lines.push(context.applyOutcome.appliedChanges === true
      ? 'APPLY: host mutation callback executed'
      : 'APPLY: no host mutation callback executed');
  }
  return lines;
}

function createArtifactRecord(artifactPath, artifactKind) {
  return {
    artifactPath,
    artifactKind,
    producedBy: defaultExecutionProducer
  };
}

function createLogSummary(logLines) {
  return {
    lineCount: logLines.length,
    preview: logLines.slice(0, 3),
    warningCount: logLines.filter((line) => /warn/i.test(line)).length,
    errorCount: logLines.filter((line) => /error/i.test(line)).length
  };
}
