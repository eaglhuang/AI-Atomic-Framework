import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  defaultExecutionEvidenceFileName,
  defaultExecutionLogFileName,
  defaultExecutionReportDirName,
  defaultExecutionSnapshotFileName,
  defaultExecutionWorkbenchRoot,
  defaultProposalDelegatedTo,
  executeAgentTaskApplyFlag,
  executeAgentTaskNodeKind,
  executeAgentTaskNodeName
} from './execution-constants.ts';
import {
  createExecutionEvidenceDocument,
  createExecutionSnapshotDocument,
  createLogLines
} from './execution-documents.ts';
import {
  createValidationPassPlan,
  defaultRunValidationPass,
  normalizeValidationPassOutcome
} from './execution-validation.ts';

export * from './execution-constants.ts';

export function createExecuteAgentTaskEffectContract(options: any) {
  const normalizedOptions = options || {};
  return {
    nodeKind: executeAgentTaskNodeKind,
    nodeName: executeAgentTaskNodeName,
    defaultMode: 'dry-run',
    applyFlag: executeAgentTaskApplyFlag,
    proposalDelegatedTo: String(normalizedOptions.proposalDelegatedTo || defaultProposalDelegatedTo)
  };
}

export function executeAgentTask(normalizedModel: any, options: any) {
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

  let applyOutcome: {
    ok: boolean;
    appliedChanges: boolean;
    touchedFiles: string[];
    summary: string;
  } = {
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

function defaultAgentExecutor(context: any) {
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

function normalizeAgentOutcome(rawOutcome: any, fallback: any) {
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

function normalizeApplyOutcome(rawOutcome: any) {
  return {
    ok: rawOutcome?.ok !== false,
    appliedChanges: rawOutcome?.appliedChanges === true,
    touchedFiles: uniqueStrings(Array.isArray(rawOutcome?.touchedFiles) ? rawOutcome.touchedFiles : []),
    summary: String(rawOutcome?.summary || (rawOutcome?.appliedChanges === true
      ? 'Apply mode executed the host mutation callback.'
      : 'Apply mode requested without a host mutation callback.'))
  };
}

function normalizePromptDocument(normalizedModel: any, promptDocument: any) {
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

function normalizeProposedChanges(proposedChanges: any, fallbackFilePath: any) {
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

function normalizeLogLines(logLines: any, executionMode: any) {
  if (Array.isArray(logLines) && logLines.length > 0) {
    return logLines.map((line) => String(line));
  }
  return [executionMode === 'dry-run'
    ? 'DRY-RUN: captured candidate patch'
    : 'APPLY: prepared candidate patch'];
}

function resolveArtifactTargets(repositoryRoot: any, workbenchPath: any, options: any) {
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

function resolveWorkbenchPath(normalizedModel: any, repositoryRoot: any, options: any) {
  if (options.workbenchPath) {
    return path.resolve(repositoryRoot, options.workbenchPath);
  }
  const workbenchRoot = options.workbenchRoot || defaultExecutionWorkbenchRoot;
  return path.resolve(repositoryRoot, workbenchRoot, resolveCanonicalAtomFolderName(normalizedModel.identity.atomId));
}

function resolveCanonicalAtomFolderName(atomId: any) {
  const folderName = String(atomId || '').trim();
  if (!folderName) {
    throw new Error('Atomic ID is required to resolve the canonical atom folder.');
  }
  if (folderName.includes('/') || folderName.includes('\\')) {
    throw new Error(`Atomic ID cannot contain path separators: ${folderName}`);
  }
  return folderName;
}

function normalizeLifecycleMode(value: any) {
  return String(value || '').trim() === 'evolution' ? 'evolution' : 'birth';
}

function writeJson(filePath: any, value: any) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath: any, content: any) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function uniqueStrings(values: any): string[] {
  return Array.from(new Set<string>((values || []).map((value: any) => toPortablePath(String(value))).filter(Boolean)));
}

function toPortablePath(value: any) {
  return String(value || '').replace(/\\/g, '/');
}
