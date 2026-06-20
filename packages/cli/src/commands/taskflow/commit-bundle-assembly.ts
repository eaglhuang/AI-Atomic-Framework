import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTaskflowCommitMessage } from './commit-messages.ts';
import { expandDirectoryDeliverableDeclarations } from '../tasks/historical-delivery.ts';
import { loadTaskDocumentOrThrow } from '../tasks/public-surface.ts';
import { assertCloseWindowStagingAllowed } from '../tasks/close-window-lock.ts';
import { listOptionalEvidenceBundleGovernanceArtifacts } from './closeback-orchestration.ts';
import { runAtmGit } from '../git-governance.ts';
import { CliError, quoteCliValue } from '../shared.ts';

export type TaskflowCommitMode = 'auto-commit' | 'stage-only' | 'dry-run';

export interface TaskflowIndexIsolation {
  verified: boolean;
  expectedStageFiles: string[];
  preStagedFiles: string[];
  unexpectedStagedFiles: string[];
}

export interface TaskflowCommitRepoBundle {
  repoRoot: string | null;
  stageFiles: string[];
  commitMessage: string;
  commitCommand: string;
  commitSha: string | null;
  status: 'preview' | 'staged' | 'committed' | 'skipped' | 'failed' | 'uncomputed';
  reason?: string | null;
  indexIsolation?: TaskflowIndexIsolation;
}

export interface TaskflowScopeAmendmentProposal {
  required: boolean;
  candidateFiles: string[];
  reason: string | null;
  remediationCommand: string | null;
  humanReviewRequired: boolean;
  notes: string[];
}

export interface TaskflowGovernedCommitBundle {
  schemaId: 'atm.taskflowGovernedCommitBundle.v1';
  taskId: string;
  actorId: string | null;
  targetRepo: TaskflowCommitRepoBundle;
  planningRepo: TaskflowCommitRepoBundle;
  commitMode: TaskflowCommitMode;
  failClosed: boolean;
  recoveryCommand: string | null;
  targetDeliveryFiles: string[];
  targetGovernanceFiles: string[];
  planningFiles: string[];
  excludedDirtyFiles: string[];
  excludedReasons: Record<string, string>;
  scopeAmendment: TaskflowScopeAmendmentProposal;
}

export interface TaskflowDeliveryCommit {
  repoRoot: string;
  stageFiles: string[];
  commitMessage: string;
  commitSha: string | null;
  status: 'committed';
}

export interface DeferredGovernanceDirtyFile {
  file: string;
  snapshotPath: string;
  originalSha256: string;
  restoredAt: string | null;
}

export interface DeferredGovernanceDirtyReport {
  schemaId: 'atm.deferredGovernanceDirty.v1';
  requested: boolean;
  files: DeferredGovernanceDirtyFile[];
  restored: boolean;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\\/g, '/')).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function normalizeRepoRelativePath(repoRoot: string, filePath: string): string {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
  return path.relative(repoRoot, resolved).replace(/\\/g, '/');
}

function listExistingFilesRecursively(root: string, relativeDirectory: string): string[] {
  const directory = path.join(root, relativeDirectory);
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDirectory.replace(/\\/g, '/'), entry.name);
    const absolutePath = path.join(root, relativePath);
    if (entry.isDirectory()) {
      files.push(...listExistingFilesRecursively(root, relativePath));
    } else if (entry.isFile()) {
      files.push(normalizeRepoRelativePath(root, absolutePath));
    }
  }
  return files;
}

function tryGitScalar(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim() || null;
  } catch {
    return null;
  }
}

function runGitOrThrow(cwd: string, args: readonly string[]) {
  execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function runGitWithEnv(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv) {
  execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env
  });
}

function readGitRoot(startPath: string): string | null {
  const probe = existsSync(startPath) && statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
  const root = tryGitScalar(probe, ['rev-parse', '--show-toplevel']);
  return root ? path.resolve(root) : null;
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function extractTaskStringList(taskDocument: Record<string, unknown>, key: string): string[] {
  const value = taskDocument[key];
  return Array.isArray(value)
    ? value.map((entry) => typeof entry === 'string' ? entry.trim().replace(/\\/g, '/') : '').filter(Boolean)
    : [];
}

function isCanonicalTaskflowDeliverableCandidate(value: string): boolean {
  const normalized = value.trim().replace(/\\/g, '/');
  if (!normalized) return false;
  if (normalized.startsWith('.atm/')) return false;
  if (/[\\/]$/.test(normalized)) return false;
  return true;
}

function extractTaskflowDeliverables(taskDocument: Record<string, unknown>): string[] {
  const explicit = extractTaskStringList(taskDocument, 'deliverables');
  if (explicit.length > 0) return explicit;
  const scopePaths = extractTaskStringList(taskDocument, 'scopePaths');
  return uniqueSorted(scopePaths.filter(isCanonicalTaskflowDeliverableCandidate));
}

function sourcePlanPathOf(taskDocument: Record<string, unknown>): string | null {
  const source = taskDocument.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const planPath = (source as Record<string, unknown>).planPath;
  return typeof planPath === 'string' && planPath.trim() ? planPath.trim() : null;
}

function taskflowPathMatches(filePath: string, declaredPath: string): boolean {
  const file = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const declared = declaredPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!file || !declared) return false;
  return file === declared || file.startsWith(`${declared}/`);
}

function buildScopeAmendmentProposal(input: {
  taskId: string;
  actorId: string | null;
  taskDocument: Record<string, unknown>;
  candidateFiles: string[];
  reason: string | null;
}): TaskflowScopeAmendmentProposal {
  const candidateFiles = uniqueSorted(input.candidateFiles);
  if (candidateFiles.length === 0) {
    return {
      required: false,
      candidateFiles,
      reason: null,
      remediationCommand: null,
      humanReviewRequired: false,
      notes: []
    };
  }
  const planPath = sourcePlanPathOf(input.taskDocument);
  const remediationCommand = planPath
    ? `node atm.mjs tasks import --from ${quoteCliValue(planPath)} --write --force --json`
    : `node atm.mjs tasks scope add --task ${input.taskId} --actor ${input.actorId ?? '<actor>'} --add ${candidateFiles.join(',')} --json`;
  return {
    required: true,
    candidateFiles,
    reason: input.reason ?? 'Dirty files overlap the task scope but are not justified by deliverables and targetAllowedFiles.',
    remediationCommand,
    humanReviewRequired: true,
    notes: [
      'Do not restore, checkout, clean, or delete another agent active work to satisfy closeout.',
      'Repair the governed task metadata or direction lock, rerun taskflow close --dry-run, then close through taskflow close --write.',
      'The CLI-computed bundle remains authoritative; LLM review may flag omissions but must not append files ad hoc.'
    ]
  };
}

function getDirtyFiles(cwd: string): string[] {
  const output = tryGitScalar(cwd, ['status', '--porcelain', '-uall']) ?? '';
  const files: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let filePart = line.slice(2).trim();
    if (filePart.startsWith('"') && filePart.endsWith('"')) {
      try {
        filePart = JSON.parse(filePart);
      } catch {
        filePart = filePart.slice(1, -1);
      }
    }
    if (line.startsWith('R ')) {
      const parts = filePart.split(' -> ');
      if (parts[1]) filePart = parts[1].trim();
    }
    files.push(filePart.replace(/\\/g, '/'));
  }
  return [...new Set(files.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function getHistoricalCommittedFiles(cwd: string, refs: string[]): string[] {
  const files: string[] = [];
  for (const ref of refs) {
    if (!ref) continue;
    const commitSha = tryGitScalar(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]);
    if (!commitSha) continue;
    const output = tryGitScalar(cwd, ['show', '--pretty=format:', '--name-only', commitSha, '--']) ?? '';
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) files.push(trimmed.replace(/\\/g, '/'));
    }
  }
  return [...new Set(files)];
}

export function readStagedFiles(repoRoot: string): string[] {
  const output = tryGitScalar(repoRoot, ['diff', '--cached', '--name-only']) ?? '';
  return uniqueSorted(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

function existingBundleFiles(repo: TaskflowCommitRepoBundle): string[] {
  if (!repo.repoRoot) return [];
  return uniqueSorted(repo.stageFiles.filter((file) => existsSync(path.resolve(repo.repoRoot ?? '', file))));
}

function buildIndexIsolation(repo: TaskflowCommitRepoBundle, stagedFiles: string[]): TaskflowIndexIsolation {
  const expectedStageFiles = existingBundleFiles(repo);
  const expected = new Set(expectedStageFiles);
  const preStagedFiles = uniqueSorted(stagedFiles);
  const unexpectedStagedFiles = preStagedFiles.filter((file) => !expected.has(file));
  return {
    verified: unexpectedStagedFiles.length === 0,
    expectedStageFiles,
    preStagedFiles,
    unexpectedStagedFiles
  };
}

function verifyRepoIndexIsolation(
  repo: TaskflowCommitRepoBundle,
  phase: 'pre-stage' | 'post-stage',
  strict = true
): TaskflowCommitRepoBundle {
  if (!repo.repoRoot) return repo;
  const isolation = buildIndexIsolation(repo, readStagedFiles(repo.repoRoot));
  const nextRepo = { ...repo, indexIsolation: isolation };
  if (strict && !isolation.verified) {
    const restoreCommand = isolation.unexpectedStagedFiles.length > 0
      ? `git restore --staged -- ${isolation.unexpectedStagedFiles.map((entry) => JSON.stringify(entry)).join(' ')}`
      : null;
    throw new CliError('ATM_TASKFLOW_CLOSE_INDEX_NOT_ISOLATED', `taskflow close ${phase} index isolation failed; unexpected staged files would be included in the governed commit.`, {
      exitCode: 1,
      details: {
        repoRoot: repo.repoRoot,
        phase,
        indexIsolation: isolation,
        restoreCommand,
        remediation: restoreCommand
          ? `Unstage unrelated files, then rerun taskflow close: ${restoreCommand}`
          : 'Unstage unrelated files or commit them separately, then rerun taskflow close.'
      }
    });
  }
  return nextRepo;
}

function commitCommandFor(input: {
  repoRoot: string | null;
  taskId: string;
  actorId: string | null;
  commitMessage: string;
  repoKind: 'target' | 'planning';
}): string {
  if (!input.repoRoot) return '';
  if (input.repoKind === 'target') {
    return `node atm.mjs git commit --cwd ${quoteCliValue(input.repoRoot)} --actor ${quoteCliValue(input.actorId ?? '<actor>')} --task ${input.taskId} --message ${quoteCliValue(input.commitMessage)} --json`;
  }
  const messageParts = [
    input.commitMessage,
    '',
    `ATM-Actor: ${input.actorId ?? '<actor>'}`,
    `ATM-Task: ${input.taskId}`,
    'ATM-Surface: taskflow-close-planning-bundle'
  ];
  return `git -C ${quoteCliValue(input.repoRoot)} commit -m ${quoteCliValue(messageParts.join('\n'))}`;
}

function extractBackendStageFiles(backendResult: Record<string, unknown> | null): string[] {
  const evidence = backendResult?.evidence as Record<string, unknown> | undefined;
  if (!evidence) return [];
  const files: string[] = [];
  for (const key of ['taskPath', 'closurePacketPath', 'transitionPath']) {
    const value = evidence[key];
    if (typeof value === 'string' && value.trim()) files.push(value);
  }
  const allowedFiles = evidence.closeCommitWindowAllowedFiles;
  if (Array.isArray(allowedFiles)) {
    files.push(...allowedFiles.filter((value): value is string => typeof value === 'string'));
  }
  return files;
}

function resolveHistoricalBatchPath(cwd: string, batchRef: string) {
  const trimmed = batchRef.trim();
  if (!trimmed) return null;
  if (path.isAbsolute(trimmed)) return trimmed;
  if (trimmed.includes('/') || trimmed.includes('\\')) return path.resolve(cwd, trimmed);
  return path.join(cwd, '.atm', 'history', 'evidence', 'historical-batches', trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`);
}

function resolveExistingHistoricalBatchStageFile(cwd: string, batchRef?: string | null): string | null {
  if (!batchRef) return null;
  const batchPath = resolveHistoricalBatchPath(cwd, batchRef);
  if (!batchPath || !existsSync(batchPath)) return null;
  return normalizeRepoRelativePath(cwd, batchPath);
}

function resolvePlanningPath(cwd: string, planningMirrorPath: string | null): { repoRoot: string | null; relativePath: string | null; reason: string | null } {
  if (!planningMirrorPath) {
    return { repoRoot: null, relativePath: null, reason: 'planning mirror path is unavailable' };
  }
  const absolutePath = path.isAbsolute(planningMirrorPath)
    ? path.resolve(planningMirrorPath)
    : path.resolve(cwd, planningMirrorPath);
  const repoRoot = readGitRoot(absolutePath);
  if (!repoRoot) {
    return { repoRoot: null, relativePath: null, reason: `no git repository found for planning path ${planningMirrorPath}` };
  }
  return {
    repoRoot,
    relativePath: normalizeRepoRelativePath(repoRoot, absolutePath),
    reason: null
  };
}

export function isDeferrableGovernanceDirtyFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (normalized === '.atm/history/evidence/git-head.jsonl') return true;
  if (/^\.atm\/history\/evidence\/[^/]+\.bundle-manifest\.json$/.test(normalized)) return true;
  return false;
}

function listUnstagedDirtyFiles(repoRoot: string): string[] {
  const output = tryGitScalar(repoRoot, ['diff', '--name-only']) ?? '';
  return uniqueSorted(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

export function deferGovernanceDirtyFiles(repoRoot: string, requested: boolean): DeferredGovernanceDirtyReport {
  const report: DeferredGovernanceDirtyReport = {
    schemaId: 'atm.deferredGovernanceDirty.v1',
    requested,
    files: [],
    restored: false
  };
  if (!requested) return report;
  const candidates = listUnstagedDirtyFiles(repoRoot).filter(isDeferrableGovernanceDirtyFile);
  if (candidates.length === 0) {
    report.restored = true;
    return report;
  }
  const snapshotRoot = path.join(repoRoot, '.atm', 'runtime', 'snapshots');
  mkdirSync(snapshotRoot, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const file of candidates) {
    const absolutePath = path.join(repoRoot, file);
    const content = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
    const snapshotPath = path.join(snapshotRoot, `close-window-governance-dirty-${timestamp}-${file.replace(/[\\/]/g, '__')}.json`);
    writeFileSync(snapshotPath, `${JSON.stringify({
      schemaId: 'atm.closeWindowGovernanceDirtySnapshot.v1',
      file,
      originalSha256: sha256Text(content),
      content,
      createdAt: new Date().toISOString(),
      restoredAt: null
    }, null, 2)}\n`, 'utf8');
    runGitOrThrow(repoRoot, ['restore', '--worktree', '--', file]);
    report.files.push({
      file,
      snapshotPath: normalizeRepoRelativePath(repoRoot, snapshotPath),
      originalSha256: sha256Text(content),
      restoredAt: null
    });
  }
  return report;
}

export function restoreDeferredGovernanceDirtyFiles(repoRoot: string, report: DeferredGovernanceDirtyReport): DeferredGovernanceDirtyReport {
  if (report.restored || report.files.length === 0) {
    return { ...report, restored: true };
  }
  const restoredAt = new Date().toISOString();
  const files = report.files.map((entry) => {
    const snapshotPath = path.join(repoRoot, entry.snapshotPath);
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Record<string, unknown>;
    const file = typeof snapshot.file === 'string' ? snapshot.file : entry.file;
    const content = typeof snapshot.content === 'string' ? snapshot.content : '';
    const absolutePath = path.join(repoRoot, file);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf8');
    writeFileSync(snapshotPath, `${JSON.stringify({ ...snapshot, restoredAt }, null, 2)}\n`, 'utf8');
    return { ...entry, restoredAt };
  });
  return {
    ...report,
    files,
    restored: true
  };
}

export function buildTaskflowCommitBundle(input: {
  cwd: string;
  taskId: string;
  actorId: string | null;
  commitMode: TaskflowCommitMode;
  planningMirrorPath: string | null;
  rosterIndexPath: string | null;
  backendResult?: Record<string, unknown> | null;
  historicalDeliveryRefs?: string[];
  historicalBatchRef?: string | null;
  planningAuthorityDeliveryOk?: boolean;
}): TaskflowGovernedCommitBundle {
  const targetRepoRoot = path.resolve(input.cwd);

  let taskDocument: Record<string, unknown> = {};
  try {
    const loaded = loadTaskDocumentOrThrow(targetRepoRoot, input.taskId);
    taskDocument = loaded.taskDocument;
  } catch {
    // fail closed later
  }

  const deliverables = extractTaskflowDeliverables(taskDocument);
  const scopePaths = extractTaskStringList(taskDocument, 'scopePaths');
  const targetAllowedFiles = extractTaskStringList(taskDocument, 'targetAllowedFiles');

  const dirtyFiles = getDirtyFiles(targetRepoRoot);
  const historicalCommitted = getHistoricalCommittedFiles(targetRepoRoot, input.historicalDeliveryRefs ?? []);
  const historicalCloseback = historicalCommitted.length > 0;

  let allowed = targetAllowedFiles;
  if (allowed.length === 0) {
    allowed = scopePaths;
  }

  const targetDeliveryFiles: string[] = [];
  const historicalBatchStageFile = resolveExistingHistoricalBatchStageFile(targetRepoRoot, input.historicalBatchRef);
  const targetGovernanceFiles: string[] = [
    `.atm/history/tasks/${input.taskId}.json`,
    `.atm/history/evidence/${input.taskId}.json`,
    `.atm/history/evidence/${input.taskId}.closure-packet.json`,
    ...listOptionalEvidenceBundleGovernanceArtifacts(targetRepoRoot, input.taskId),
    ...(historicalBatchStageFile ? [historicalBatchStageFile] : []),
    ...listExistingFilesRecursively(targetRepoRoot, `.atm/history/task-events/${input.taskId}`),
    ...extractBackendStageFiles(input.backendResult ?? null)
  ];

  const excludedDirtyFiles: string[] = [];
  const excludedReasons: Record<string, string> = {};
  const scopeAmendmentCandidateFiles: string[] = [];
  let metadataFailClosed = false;
  let failClosedReason: string | null = null;

  if (deliverables.length === 0) {
    metadataFailClosed = true;
    failClosedReason = 'Task metadata error: "deliverables" list is empty or missing.';
  }

  const directoryExpansion = expandDirectoryDeliverableDeclarations(targetRepoRoot, deliverables);
  if (!directoryExpansion.ok) {
    metadataFailClosed = true;
    failClosedReason = directoryExpansion.failClosedReason;
  }
  const effectiveDeliverables = directoryExpansion.ok ? directoryExpansion.effectiveDeliverables : deliverables;

  for (const del of effectiveDeliverables) {
    const isAllowed = allowed.some((all) => taskflowPathMatches(del, all));
    if (!isAllowed) {
      metadataFailClosed = true;
      failClosedReason = `Task metadata error: declared deliverable "${del}" falls outside active direction lock / targetAllowedFiles.`;
    }
  }

  const hasPlanningFile = effectiveDeliverables.some((del) => del.startsWith('docs/tasks/') || del.endsWith('.task.md'));
  const hasTargetFile = effectiveDeliverables.some((del) => !del.startsWith('docs/tasks/') && !del.endsWith('.task.md'));
  if (!input.planningAuthorityDeliveryOk && hasPlanningFile && hasTargetFile) {
    metadataFailClosed = true;
    failClosedReason = 'Task metadata error: deliverables contain mixed planning-path and target-path declarations.';
  }

  for (const file of dirtyFiles) {
    if (file.startsWith('.atm/')) continue;
    const inScope = scopePaths.some((sp) => taskflowPathMatches(file, sp));
    const isDeclared = effectiveDeliverables.some((del) => taskflowPathMatches(file, del));
    const isAllowed = allowed.some((all) => taskflowPathMatches(file, all));

    if (isDeclared && isAllowed) {
      targetDeliveryFiles.push(file);
    } else {
      excludedDirtyFiles.push(file);
      if (inScope) {
        if (historicalCloseback) {
          excludedReasons[file] = 'inside scope but outside declared deliverables; excluded as advisory residue during historical closeback';
        } else {
          scopeAmendmentCandidateFiles.push(file);
          metadataFailClosed = true;
          failClosedReason = `Scope amendment required: dirty file "${file}" is inside task scope but is not declared in deliverables and targetAllowedFiles.`;
          excludedReasons[file] = 'inside scope but not declared/allowed (fail-closed trigger)';
        }
      } else {
        excludedReasons[file] = 'outside task scope; excluded from governed bundle and must be left untouched';
      }
    }
  }

  const scopeAmendment = buildScopeAmendmentProposal({
    taskId: input.taskId,
    actorId: input.actorId,
    taskDocument,
    candidateFiles: scopeAmendmentCandidateFiles,
    reason: failClosedReason
  });

  const finalDeliveryFiles = targetDeliveryFiles.filter(
    (file) => !historicalCommitted.some((h) => taskflowPathMatches(file, h))
  );

  const targetStageFiles = uniqueSorted([
    ...finalDeliveryFiles,
    ...targetGovernanceFiles
  ]);

  const planning = resolvePlanningPath(targetRepoRoot, input.planningMirrorPath);
  const planningStageFiles = planning.repoRoot && planning.relativePath
    ? uniqueSorted([
      planning.relativePath,
      ...(input.rosterIndexPath
        ? [normalizeRepoRelativePath(planning.repoRoot, path.isAbsolute(input.rosterIndexPath)
          ? input.rosterIndexPath
          : path.resolve(planning.repoRoot, input.rosterIndexPath))]
        : [])
    ])
    : [];

  const targetMessage = buildTaskflowCommitMessage('target', { taskId: input.taskId });
  const planningMessage = buildTaskflowCommitMessage('planning', { taskId: input.taskId });
  const failClosed = metadataFailClosed || targetStageFiles.length === 0 || !planning.repoRoot || planningStageFiles.length === 0;

  return {
    schemaId: 'atm.taskflowGovernedCommitBundle.v1',
    taskId: input.taskId,
    actorId: input.actorId,
    targetRepo: {
      repoRoot: targetRepoRoot,
      stageFiles: targetStageFiles,
      commitMessage: targetMessage,
      commitCommand: commitCommandFor({
        repoRoot: targetRepoRoot,
        taskId: input.taskId,
        actorId: input.actorId,
        commitMessage: targetMessage,
        repoKind: 'target'
      }),
      commitSha: null,
      status: input.commitMode === 'dry-run' ? 'preview' : 'uncomputed',
      reason: failClosedReason || (targetStageFiles.length > 0 ? null : 'target close artifact paths could not be computed')
    },
    planningRepo: {
      repoRoot: planning.repoRoot,
      stageFiles: planningStageFiles,
      commitMessage: planningMessage,
      commitCommand: commitCommandFor({
        repoRoot: planning.repoRoot,
        taskId: input.taskId,
        actorId: input.actorId,
        commitMessage: planningMessage,
        repoKind: 'planning'
      }),
      commitSha: null,
      status: input.commitMode === 'dry-run' ? 'preview' : 'uncomputed',
      reason: planning.reason
    },
    commitMode: input.commitMode,
    failClosed,
    recoveryCommand: null,
    targetDeliveryFiles: finalDeliveryFiles,
    targetGovernanceFiles,
    planningFiles: planningStageFiles,
    excludedDirtyFiles,
    excludedReasons,
    scopeAmendment
  };
}

export function assertCommitBundleReady(bundle: TaskflowGovernedCommitBundle) {
  if (bundle.failClosed || !bundle.targetRepo.repoRoot || !bundle.planningRepo.repoRoot) {
    throw new CliError('ATM_TASKFLOW_CLOSE_COMMIT_BUNDLE_INCOMPLETE', 'taskflow close cannot compute the dual-repo governed commit bundle.', {
      exitCode: 1,
      details: { governedCommitBundle: bundle }
    });
  }
}

function stageRepoBundle(repo: TaskflowCommitRepoBundle, taskId?: string): TaskflowCommitRepoBundle {
  if (repo.repoRoot && taskId) {
    assertCloseWindowStagingAllowed({
      cwd: repo.repoRoot,
      taskId,
      operation: 'taskflow close bundle staging'
    });
  }
  if (!repo.repoRoot || repo.stageFiles.length === 0) {
    return { ...repo, status: 'uncomputed' };
  }
  const existingFiles = existingBundleFiles(repo);
  if (existingFiles.length === 0) {
    return {
      ...repo,
      stageFiles: existingFiles,
      status: 'skipped',
      reason: 'no existing bundle files to stage',
      indexIsolation: buildIndexIsolation(repo, readStagedFiles(repo.repoRoot))
    };
  }
  runGitOrThrow(repo.repoRoot, ['add', '--', ...existingFiles]);
  return { ...repo, stageFiles: existingFiles, status: 'staged' };
}

async function commitTaskflowBundle(input: {
  bundle: TaskflowGovernedCommitBundle;
  actorId: string;
  taskId: string;
}): Promise<TaskflowGovernedCommitBundle> {
  const targetPreStagedFiles = input.bundle.targetRepo.repoRoot ? readStagedFiles(input.bundle.targetRepo.repoRoot) : [];
  const targetForeignStagedFiles = targetPreStagedFiles.filter((file) => !input.bundle.targetRepo.stageFiles.includes(file));
  if (input.bundle.targetRepo.repoRoot && targetForeignStagedFiles.length > 0) {
    runGitOrThrow(input.bundle.targetRepo.repoRoot, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...targetForeignStagedFiles]);
  }
  commitRepoWithTemporaryIndex(
    input.bundle.targetRepo.repoRoot ?? '',
    input.bundle.targetRepo.stageFiles,
    ['commit', '-m', input.bundle.targetRepo.commitMessage]
  );
  const targetCommitSha = input.bundle.targetRepo.repoRoot
    ? tryGitScalar(input.bundle.targetRepo.repoRoot, ['rev-parse', '--verify', 'HEAD'])
    : null;
  if (input.bundle.targetRepo.repoRoot && targetForeignStagedFiles.length > 0) {
    runGitOrThrow(input.bundle.targetRepo.repoRoot, ['add', '--', ...targetForeignStagedFiles]);
  }
  let targetRepo: TaskflowCommitRepoBundle = {
    ...input.bundle.targetRepo,
    commitSha: targetCommitSha,
    status: 'committed'
  };
  let planningRepo: TaskflowCommitRepoBundle = input.bundle.planningRepo;
  try {
    if (!planningRepo.repoRoot) {
      throw new Error('planning repo root missing');
    }
    const planningPreStagedFiles = readStagedFiles(planningRepo.repoRoot);
    const planningForeignStagedFiles = planningPreStagedFiles.filter((file) => !planningRepo.stageFiles.includes(file));
    if (planningForeignStagedFiles.length > 0) {
      runGitOrThrow(planningRepo.repoRoot, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', ...planningForeignStagedFiles]);
    }
    const planningMessage = [
      planningRepo.commitMessage,
      '',
      `ATM-Actor: ${input.actorId}`,
      `ATM-Task: ${input.taskId}`,
      'ATM-Surface: taskflow-close-planning-bundle'
    ].join('\n');
    commitRepoWithTemporaryIndex(planningRepo.repoRoot, planningRepo.stageFiles, ['commit', '-m', planningMessage]);
    if (planningForeignStagedFiles.length > 0) {
      runGitOrThrow(planningRepo.repoRoot, ['add', '--', ...planningForeignStagedFiles]);
    }
    planningRepo = {
      ...planningRepo,
      commitSha: tryGitScalar(planningRepo.repoRoot, ['rev-parse', '--verify', 'HEAD']),
      status: 'committed'
    };
  } catch (error) {
    planningRepo = {
      ...planningRepo,
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error)
    };
    targetRepo = { ...targetRepo, status: 'committed' };
    return {
      ...input.bundle,
      targetRepo,
      planningRepo,
      failClosed: true,
      recoveryCommand: 'Planning repo commit failed after target repo governance commit succeeded. Inspect planning repo status and reconcile manually.'
    };
  }
  return {
    ...input.bundle,
    targetRepo,
    planningRepo,
    failClosed: false,
    recoveryCommand: null
  };
}

function commitRepoWithTemporaryIndex(repoRoot: string, stageFiles: readonly string[], args: readonly string[]) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-taskflow-commit-index-'));
  const tempIndexFile = path.join(tempDir, 'index');
  const env = {
    ...process.env,
    GIT_INDEX_FILE: tempIndexFile
  };
  try {
    runGitWithEnv(repoRoot, ['read-tree', 'HEAD'], env);
    if (stageFiles.length > 0) {
      runGitWithEnv(repoRoot, ['add', '-A', '--', ...stageFiles], env);
    }
    runGitWithEnv(repoRoot, args, env);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function commitTaskflowDeliveryFiles(input: {
  bundle: TaskflowGovernedCommitBundle;
  actorId: string;
  taskId: string;
}): Promise<TaskflowDeliveryCommit | null> {
  const repoRoot = input.bundle.targetRepo.repoRoot;
  const stageFiles = uniqueSorted(input.bundle.targetDeliveryFiles);
  if (!repoRoot || stageFiles.length === 0) {
    return null;
  }
  const deliveryBundle: TaskflowCommitRepoBundle = {
    repoRoot,
    stageFiles,
    commitMessage: `chore(taskflow): deliver ${input.taskId} source bundle`,
    commitCommand: commitCommandFor({
      repoRoot,
      actorId: input.actorId,
      taskId: input.taskId,
      commitMessage: `chore(taskflow): deliver ${input.taskId} source bundle`,
      repoKind: 'target'
    }),
    commitSha: null,
    status: 'uncomputed'
  };
  const preflight = verifyRepoIndexIsolation(deliveryBundle, 'pre-stage');
  const staged = verifyRepoIndexIsolation(stageRepoBundle(preflight, input.taskId), 'post-stage');
  if (staged.status !== 'staged') {
    return null;
  }
  const targetResult = await runAtmGit([
    'commit',
    '--cwd', repoRoot,
    '--actor', input.actorId,
    '--task', input.taskId,
    '--message', deliveryBundle.commitMessage,
    '--json'
  ]);
  const commitSha = String((targetResult.evidence as Record<string, unknown>)?.commitSha ?? '') || null;
  return {
    repoRoot,
    stageFiles: staged.stageFiles,
    commitMessage: deliveryBundle.commitMessage,
    commitSha,
    status: 'committed'
  };
}

export async function finalizeTaskflowCommitBundle(input: {
  bundle: TaskflowGovernedCommitBundle;
  actorId: string;
  taskId: string;
}): Promise<TaskflowGovernedCommitBundle> {
  assertCommitBundleReady(input.bundle);
  const strictIsolation = input.bundle.commitMode === 'stage-only';
  const preflightTarget = verifyRepoIndexIsolation(input.bundle.targetRepo, 'pre-stage', strictIsolation);
  const preflightPlanning = verifyRepoIndexIsolation(input.bundle.planningRepo, 'pre-stage', strictIsolation);
  if (input.bundle.commitMode === 'stage-only') {
    const stagedTarget = verifyRepoIndexIsolation(stageRepoBundle(preflightTarget, input.taskId), 'post-stage', true);
    const stagedPlanning = verifyRepoIndexIsolation(stageRepoBundle(preflightPlanning, input.taskId), 'post-stage', true);
    return {
      ...input.bundle,
      targetRepo: stagedTarget,
      planningRepo: stagedPlanning
    };
  }
  const bundle: TaskflowGovernedCommitBundle = {
    ...input.bundle,
    targetRepo: preflightTarget,
    planningRepo: preflightPlanning
  };
  return commitTaskflowBundle({
    bundle,
    actorId: input.actorId,
    taskId: input.taskId
  });
}
