import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

export function createExecuteAgentTaskEffectContract(options) {
  const normalizedOptions = options || {};
  return {
    nodeKind: executeAgentTaskNodeKind,
    nodeName: executeAgentTaskNodeName,
    defaultMode: 'dry-run',
    applyFlag: executeAgentTaskApplyFlag,
    proposalDelegatedTo: String(normalizedOptions.proposalDelegatedTo || defaultProposalDelegatedTo)
  };
}

export function executeAgentTask(normalizedModel, options) {
  const normalizedOptions = options || {};
  const atomId = normalizedModel?.identity?.atomId;
  if (!atomId) {
    throw new Error('Normalized model identity.atomId is required.');
  }

  const repositoryRoot = path.resolve(normalizedOptions.repositoryRoot ?? process.cwd());
  const lifecycleMode = normalizeLifecycleMode(normalizedModel?.execution?.compatibility?.lifecycleMode);
  const executionMode = normalizedOptions.applyChanges === true ? 'apply' : 'dry-run';
  const generatedAt = String(normalizedOptions.now || new Date().toISOString());
  const effectNode = createExecuteAgentTaskEffectContract(normalizedOptions);
  const promptDocument = normalizePromptDocument(normalizedModel, normalizedOptions.promptDocument || normalizedOptions.prompt);
  const workbenchPath = resolveWorkbenchPath(normalizedModel, repositoryRoot, normalizedOptions);
  const artifactTargets = resolveArtifactTargets(repositoryRoot, workbenchPath, normalizedOptions);
  const validationCommands = uniqueStrings(promptDocument.validationCommands);
  const agentExecutor = typeof normalizedOptions.agentExecutor === 'function'
    ? normalizedOptions.agentExecutor
    : defaultAgentExecutor;
  const rawAgentOutcome = agentExecutor({
    repositoryRoot,
    atomId,
    lifecycleMode,
    executionMode,
    promptDocument,
    effectNode,
    workbenchPath: artifactTargets.workbenchPath,
    validationCommands
  });
  const agentOutcome = normalizeAgentOutcome(rawAgentOutcome, {
    executionMode,
    defaultTouchedFile: promptDocument.allowedFiles[promptDocument.allowedFiles.length - 1] || promptDocument.promptPath,
    artifactPath: artifactTargets.snapshotPath,
    logPath: artifactTargets.logPath
  });

  let applyOutcome = {
    ok: true,
    appliedChanges: false,
    touchedFiles: [],
    summary: executionMode === 'apply'
      ? 'Apply mode requested without a host mutation callback.'
      : 'Dry-run preserved the host project.'
  };

  if (executionMode === 'apply') {
    const applyExecution = typeof normalizedOptions.applyExecution === 'function'
      ? normalizedOptions.applyExecution
      : defaultApplyExecution;
    const rawApplyOutcome = applyExecution({
      repositoryRoot,
      atomId,
      lifecycleMode,
      executionMode,
      promptDocument,
      effectNode,
      agentOutcome
    });
    applyOutcome = normalizeApplyOutcome(rawApplyOutcome);
  }

  const validationPlan = createValidationPassPlan(lifecycleMode, artifactTargets.reportsDirPath);
  const validationExecutor = typeof normalizedOptions.runValidationPass === 'function'
    ? normalizedOptions.runValidationPass
    : defaultRunValidationPass;
  const validationPasses = validationPlan.map((pass) => {
    const rawPassOutcome = validationExecutor({
      repositoryRoot,
      atomId,
      lifecycleMode,
      executionMode,
      pass,
      promptDocument,
      validationCommands,
      effectNode
    });
    const validationPass = normalizeValidationPassOutcome(rawPassOutcome, pass);
    writeJson(path.resolve(repositoryRoot, validationPass.reportPath), validationPass.reportDocument);
    return validationPass.record;
  });

  const logLines = createLogLines({
    executionMode,
    lifecycleMode,
    agentOutcome,
    validationPasses,
    applyOutcome
  });
  writeText(path.resolve(repositoryRoot, artifactTargets.logPath), `${logLines.join('\n')}\n`);

  const snapshotDocument = createExecutionSnapshotDocument({
    atomId,
    lifecycleMode,
    executionMode,
    generatedAt,
    promptDocument,
    agentOutcome,
    validationPasses,
    effectNode
  });
  writeJson(path.resolve(repositoryRoot, artifactTargets.snapshotPath), snapshotDocument);

  const ok = agentOutcome.ok === true
    && applyOutcome.ok === true
    && validationPasses.every((pass) => pass.ok === true);
  const evidenceDocument = createExecutionEvidenceDocument({
    atomId,
    lifecycleMode,
    executionMode,
    generatedAt,
    promptDocument,
    effectNode,
    agentOutcome,
    applyOutcome,
    validationPasses,
    artifactTargets,
    logLines,
    ok
  });
  writeJson(path.resolve(repositoryRoot, artifactTargets.evidencePath), evidenceDocument);

  return {
    ok,
    atomId,
    lifecycleMode,
    executionMode,
    promptPath: promptDocument.promptPath,
    artifactPath: artifactTargets.snapshotPath,
    logPath: artifactTargets.logPath,
    evidencePath: artifactTargets.evidencePath,
    validationPasses,
    document: evidenceDocument,
    snapshotDocument
  };
}

function createExecutionEvidenceDocument(context) {
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

function createExecutionSnapshotDocument(context) {
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

function createLogLines(context) {
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

function normalizeValidationPassOutcome(rawOutcome, pass) {
  const ok = rawOutcome?.ok !== false;
  const exitCode = normalizeExitCode(rawOutcome?.exitCode, ok ? 0 : 1);
  const summary = String(rawOutcome?.summary || `${pass.label} validated delegated commands.`);
  const reportPath = toPortablePath(rawOutcome?.reportPath || pass.reportPath);
  const reportDocument = rawOutcome?.reportDocument && typeof rawOutcome.reportDocument === 'object'
    ? rawOutcome.reportDocument
    : {
      passId: pass.passId,
      fixtureSet: pass.fixtureSet,
      ok,
      exitCode,
      summary,
      results: Array.isArray(rawOutcome?.results) ? rawOutcome.results : []
    };

  return {
    reportPath,
    reportDocument,
    record: {
      passId: pass.passId,
      fixtureSet: pass.fixtureSet,
      ok,
      exitCode,
      reportPath,
      summary
    }
  };
}

function createValidationPassPlan(lifecycleMode, reportsDirPath) {
  if (lifecycleMode === 'evolution') {
    return [
      createValidationPass('baseline-fixtures-x-new-code', 'baseline', 'Baseline fixtures validated against the candidate code.', reportsDirPath),
      createValidationPass('new-fixtures-x-new-code', 'candidate', 'New fixtures validated against the candidate code.', reportsDirPath)
    ];
  }
  return [
    createValidationPass('current-fixtures-x-current-code', 'current', 'Current fixtures validated against the candidate code.', reportsDirPath)
  ];
}

function createValidationPass(passId, fixtureSet, label, reportsDirPath) {
  return {
    passId,
    fixtureSet,
    label,
    reportPath: `${reportsDirPath}/${passId}.report.json`
  };
}

function defaultRunValidationPass(context) {
  const results = context.validationCommands.map((command, index) => {
    const startedAt = Date.now();
    const processResult = spawnSync(command, {
      cwd: context.repositoryRoot,
      shell: true,
      encoding: 'utf8'
    });
    const exitCode = normalizeExitCode(processResult.status, 1);
    return {
      commandId: `validation-${index + 1}`,
      command,
      exitCode,
      ok: exitCode === 0,
      stdout: normalizeText(processResult.stdout),
      stderr: [normalizeText(processResult.stderr), processResult.error?.message || ''].filter(Boolean).join('\n'),
      durationMs: Math.max(0, Date.now() - startedAt),
      signal: processResult.signal || null
    };
  });

  const exitCode = results.find((entry) => entry.exitCode !== 0)?.exitCode ?? 0;
  const ok = results.every((entry) => entry.ok === true);
  return {
    ok,
    exitCode,
    summary: ok
      ? `${context.pass.label}`
      : `${context.pass.label} detected a delegated validation failure.`,
    results
  };
}

function defaultAgentExecutor(context) {
  const targetFile = context.promptDocument.allowedFiles[context.promptDocument.allowedFiles.length - 1] || context.promptDocument.promptPath;
  return {
    ok: true,
    summary: context.executionMode === 'dry-run'
      ? 'Dry-run captured a candidate patch without mutating the host project.'
      : 'Apply mode prepared a candidate patch for the host project.',
    logLines: [context.executionMode === 'dry-run'
      ? 'DRY-RUN: captured candidate patch'
      : 'APPLY: prepared candidate patch'],
    proposedChanges: [
      {
        filePath: targetFile,
        description: 'Candidate atom implementation update staged for review.'
      }
    ]
  };
}

function defaultApplyExecution() {
  return {
    ok: true,
    appliedChanges: false,
    touchedFiles: [],
    summary: 'Apply mode requested without a host mutation callback.'
  };
}

function normalizeAgentOutcome(rawOutcome, fallback) {
  const proposedChanges = normalizeProposedChanges(rawOutcome?.proposedChanges, fallback.defaultTouchedFile);
  const summary = String(rawOutcome?.summary || (fallback.executionMode === 'dry-run'
    ? 'Dry-run captured a candidate patch without mutating the host project.'
    : 'Apply mode prepared a candidate patch for the host project.'));
  const logLines = normalizeLogLines(rawOutcome?.logLines, fallback.executionMode);
  return {
    ok: rawOutcome?.ok !== false,
    summary,
    logLines,
    proposedChanges,
    touchedFiles: uniqueStrings(proposedChanges.map((entry) => entry.filePath)),
    artifactPath: fallback.artifactPath,
    logPath: fallback.logPath
  };
}

function normalizeApplyOutcome(rawOutcome) {
  return {
    ok: rawOutcome?.ok !== false,
    appliedChanges: rawOutcome?.appliedChanges === true,
    touchedFiles: uniqueStrings(Array.isArray(rawOutcome?.touchedFiles) ? rawOutcome.touchedFiles : []),
    summary: String(rawOutcome?.summary || (rawOutcome?.appliedChanges === true
      ? 'Apply mode executed the host mutation callback.'
      : 'Apply mode requested without a host mutation callback.'))
  };
}

function normalizePromptDocument(normalizedModel, promptDocument) {
  const atomId = normalizedModel?.identity?.atomId;
  const promptPath = toPortablePath(promptDocument?.promptPath || `${defaultExecutionWorkbenchRoot}/${atomId}/prompt.md`);
  const frontmatter = promptDocument?.frontmatter || {};
  const evidenceContract = frontmatter.evidenceContract || {};
  return {
    promptPath,
    allowedFiles: uniqueStrings(frontmatter.allowedFiles || [promptPath]),
    validationCommands: uniqueStrings(evidenceContract.validationCommands || normalizedModel?.execution?.validation?.commands || [])
  };
}

function normalizeProposedChanges(proposedChanges, fallbackFilePath) {
  const normalized = Array.isArray(proposedChanges)
    ? proposedChanges
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        filePath: toPortablePath(entry.filePath || fallbackFilePath),
        description: String(entry.description || 'Candidate change staged for review.')
      }))
      .filter((entry) => entry.filePath)
    : [];
  if (normalized.length > 0) {
    return normalized;
  }
  if (!fallbackFilePath) {
    return [];
  }
  return [
    {
      filePath: toPortablePath(fallbackFilePath),
      description: 'Candidate change staged for review.'
    }
  ];
}

function normalizeLogLines(logLines, executionMode) {
  if (Array.isArray(logLines) && logLines.length > 0) {
    return logLines.map((line) => String(line));
  }
  return [executionMode === 'dry-run'
    ? 'DRY-RUN: captured candidate patch'
    : 'APPLY: prepared candidate patch'];
}

function resolveArtifactTargets(repositoryRoot, workbenchPath, options) {
  const snapshotPath = toPortablePath(path.relative(repositoryRoot, path.join(workbenchPath, options.snapshotFileName || defaultExecutionSnapshotFileName)));
  const logPath = toPortablePath(path.relative(repositoryRoot, path.join(workbenchPath, options.logFileName || defaultExecutionLogFileName)));
  const evidencePath = toPortablePath(path.relative(repositoryRoot, path.join(workbenchPath, options.evidenceFileName || defaultExecutionEvidenceFileName)));
  const reportsDirPath = toPortablePath(path.relative(repositoryRoot, path.join(workbenchPath, options.reportDirName || defaultExecutionReportDirName)));
  return {
    workbenchPath: toPortablePath(path.relative(repositoryRoot, workbenchPath)),
    snapshotPath,
    logPath,
    evidencePath,
    reportsDirPath
  };
}

function resolveWorkbenchPath(normalizedModel, repositoryRoot, options) {
  if (options.workbenchPath) {
    return path.resolve(repositoryRoot, options.workbenchPath);
  }
  const workbenchRoot = options.workbenchRoot || defaultExecutionWorkbenchRoot;
  return path.resolve(repositoryRoot, workbenchRoot, resolveCanonicalAtomFolderName(normalizedModel.identity.atomId));
}

function resolveCanonicalAtomFolderName(atomId) {
  const folderName = String(atomId || '').trim();
  if (!folderName) {
    throw new Error('Atomic ID is required to resolve the canonical atom folder.');
  }
  if (folderName.includes('/') || folderName.includes('\\')) {
    throw new Error(`Atomic ID cannot contain path separators: ${folderName}`);
  }
  return folderName;
}

function normalizeLifecycleMode(value) {
  return String(value || '').trim() === 'evolution' ? 'evolution' : 'birth';
}

function normalizeExitCode(value, fallback) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return fallback;
}

function normalizeText(value) {
  return String(value || '');
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => toPortablePath(String(value))).filter(Boolean))];
}

function toPortablePath(value) {
  return String(value || '').replace(/\\/g, '/');
}
