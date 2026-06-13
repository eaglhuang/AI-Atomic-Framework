import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getCommandSpec } from './command-specs.ts';
import {
  buildResidueDiagnosisEvidence,
  generateTaskCard,
  loadTaskDocumentOrThrow,
  runTasks,
  runTasksRosterUpdate
} from './tasks/public-surface.ts';
import {
  buildCloseBackendArgv,
  buildClosebackPlan,
  buildTaskflowCloseDiagnostics,
  resolveCloseWriteSupport
} from './taskflow/close-orchestration.ts';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.ts';
import {
  buildDelegationContract,
  buildTaskflowOpenDiagnostics,
  loadProfile,
  resolveOpenerMode,
  resolveWriteSupport,
  type TaskflowProfileV1
} from './taskflow/profile-loader.ts';
import {
  canResolveHostOpenerPolicy,
  resolveHostOpenerPolicyDecision
} from './taskflow/host-opener-policy.ts';
import { runAtmGit } from './git-governance.ts';
import { quoteCliValue, relativePathFrom } from './shared.ts';

type TaskflowCommitMode = 'auto-commit' | 'stage-only' | 'dry-run';

interface TaskflowCommitRepoBundle {
  repoRoot: string | null;
  stageFiles: string[];
  commitMessage: string;
  commitCommand: string;
  commitSha: string | null;
  status: 'preview' | 'staged' | 'committed' | 'skipped' | 'failed' | 'uncomputed';
  reason?: string | null;
}

interface TaskflowGovernedCommitBundle {
  schemaId: 'atm.taskflowGovernedCommitBundle.v1';
  taskId: string;
  actorId: string | null;
  targetRepo: TaskflowCommitRepoBundle;
  planningRepo: TaskflowCommitRepoBundle;
  commitMode: TaskflowCommitMode;
  failClosed: boolean;
  recoveryCommand: string | null;
}

function buildTasksNewCommand(input: {
  taskId?: string | null;
  outputPath?: string | null;
  template?: string | null;
  title?: string | null;
}): string {
  const parts = ['node atm.mjs tasks new'];
  if (input.template) {
    parts.push(`--template ${input.template}`);
  }
  if (input.taskId) {
    parts.push(`--task-id ${input.taskId}`);
  }
  if (input.title) {
    parts.push(`--title ${JSON.stringify(input.title)}`);
  }
  if (input.outputPath) {
    parts.push(`--output ${input.outputPath}`);
  }
  return parts.join(' ');
}

function buildRosterSyncCommand(input: {
  indexPath: string;
  fromPath: string;
  dryRun?: boolean;
}): string {
  const parts = ['node atm.mjs tasks roster update', `--index ${input.indexPath}`, `--from ${input.fromPath}`];
  if (input.dryRun) {
    parts.push('--dry-run');
  }
  parts.push('--json');
  return parts.join(' ');
}

function buildTasksImportCommand(input: {
  fromPath: string;
}): string {
  return `node atm.mjs tasks import --from ${quoteCliValue(input.fromPath)} --write --json`;
}

function buildOrchestrationPlan(input: {
  profile: TaskflowProfileV1 | null;
  openerMode: ReturnType<typeof resolveOpenerMode>;
  delegationContract: ReturnType<typeof buildDelegationContract>;
  outputRoot?: string | null;
  taskId?: string | null;
  outputPath?: string | null;
  template?: string | null;
  title?: string | null;
  rosterIndexPath?: string | null;
  hostPolicyDecision?: ReturnType<typeof resolveHostOpenerPolicyDecision> | null;
}) {
  const resolvedTaskId = input.hostPolicyDecision?.taskId ?? input.taskId ?? null;
  const resolvedOutputPath = input.hostPolicyDecision?.outputPath ?? input.outputPath ?? null;
  const followUpSteps: string[] = ['generate-via-tasks-new'];
  if (input.delegationContract.hostOpenerAvailable) {
    followUpSteps.unshift('resolve-delegation');
  }
  if (input.hostPolicyDecision?.sources.taskId === 'host-policy') {
    followUpSteps.push('allocate-task-id-via-host-policy');
  }
  if (input.hostPolicyDecision?.sources.outputPath === 'host-policy') {
    followUpSteps.push('resolve-output-path-via-host-policy');
  }
  if (input.openerMode === 'template-only-fallback') {
    followUpSteps.push('operator-supply-task-id-and-output');
  }
  if (resolvedOutputPath) {
    followUpSteps.push('import-into-runtime');
  }

  const rosterSyncPolicy = input.delegationContract.policy.rosterSyncPolicy;
  const rosterIndexPath = input.rosterIndexPath ?? input.delegationContract.policy.rosterSync.indexPath;
  let rosterFollowUpCommand: string | null = null;
  if (rosterSyncPolicy === 'follow-up-command' && rosterIndexPath && resolvedOutputPath) {
    rosterFollowUpCommand = buildRosterSyncCommand({
      indexPath: rosterIndexPath,
      fromPath: resolvedOutputPath
    });
    followUpSteps.push('roster-sync-follow-up-command');
  } else if (rosterSyncPolicy === 'inline' && rosterIndexPath && resolvedOutputPath) {
    followUpSteps.push('roster-sync-inline');
  }

  return {
    generationSurface: 'tasks-new' as const,
    wouldInvokeTasksNew: true,
    wouldInvokeTasksImport: Boolean(resolvedOutputPath),
    tasksNewCommand: buildTasksNewCommand({
      taskId: resolvedTaskId,
      outputPath: resolvedOutputPath,
      template: input.template,
      title: input.title
    }),
    tasksImportCommand: resolvedOutputPath
      ? buildTasksImportCommand({
        fromPath: input.outputRoot ? resolveOutputAbsolute(input.outputRoot, resolvedOutputPath) : resolvedOutputPath
      })
      : null,
    hostOpenerInvocation: input.delegationContract.displayHint,
    rosterSyncPolicy,
    rosterIndexPath,
    rosterFollowUpCommand,
    followUpRequired: input.openerMode === 'template-only-fallback'
      || !resolvedTaskId
      || !resolvedOutputPath
      || (rosterSyncPolicy === 'follow-up-command' && Boolean(rosterFollowUpCommand)),
    followUpSteps,
    targetRepo: input.profile?.ownerRepo ?? 'adopter-repo',
    outputRepoRoot: input.outputRoot ?? null,
    profileRepoLabel: input.profile?.repoLabel ?? 'adopter-repo',
    policyDecision: {
      allocateTaskId: input.delegationContract.policy.allocateTaskId,
      resolveCanonicalOutputPath: input.delegationContract.policy.resolveCanonicalOutputPath,
      rosterSyncPolicy,
      rosterSyncIndexPath: rosterIndexPath,
      fallbackBehavior: input.delegationContract.policy.fallbackBehavior
    },
    hostPolicyDecision: input.hostPolicyDecision ?? null
  };
}

function collectHistoricalDeliveryRefs(parsed: ReturnType<typeof parseArgsForCommand>): string[] {
  const refs: string[] = [];
  const historicalDelivery = parsed.options.historicalDelivery;
  if (Array.isArray(historicalDelivery)) {
    refs.push(...historicalDelivery.map(String));
  } else if (typeof historicalDelivery === 'string' && historicalDelivery.trim()) {
    refs.push(historicalDelivery);
  }
  const deliveryCommit = parsed.options.deliveryCommit ? String(parsed.options.deliveryCommit) : null;
  if (deliveryCommit) {
    refs.push(deliveryCommit);
  }
  return [...new Set(refs)];
}

function normalizeRepoRelativePath(repoRoot: string, filePath: string): string {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
  return relativePathFrom(repoRoot, resolved).replace(/\\/g, '/');
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\\/g, '/')).filter(Boolean))].sort((a, b) => a.localeCompare(b));
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

function readGitRoot(startPath: string): string | null {
  const probe = existsSync(startPath) && statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
  const root = tryGitScalar(probe, ['rev-parse', '--show-toplevel']);
  return root ? path.resolve(root) : null;
}

function resolveProfileRepoRoot(profilePath: string | null, fallbackCwd: string): string {
  if (!profilePath) return fallbackCwd;
  const resolvedProfilePath = path.resolve(profilePath);
  return readGitRoot(resolvedProfilePath) ?? path.dirname(resolvedProfilePath);
}

function resolveTaskflowOpenOutputRoot(input: {
  profilePath: string | null;
  profile: TaskflowProfileV1 | null;
  cwd: string;
}): string {
  if (!input.profile) return input.cwd;
  return resolveProfileRepoRoot(input.profilePath, input.cwd);
}

function resolveOutputAbsolute(root: string, outputPath: string): string {
  return path.isAbsolute(outputPath) ? path.resolve(outputPath) : path.resolve(root, outputPath);
}

function runGitOrThrow(cwd: string, args: readonly string[]) {
  execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
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
    if (typeof value === 'string' && value.trim()) {
      files.push(value);
    }
  }
  const allowedFiles = evidence.closeCommitWindowAllowedFiles;
  if (Array.isArray(allowedFiles)) {
    files.push(...allowedFiles.filter((value): value is string => typeof value === 'string'));
  }
  return files;
}

function buildTargetStageFiles(cwd: string, taskId: string, backendResult: Record<string, unknown> | null): string[] {
  return uniqueSorted([
    `.atm/history/tasks/${taskId}.json`,
    `.atm/history/evidence/${taskId}.json`,
    `.atm/history/evidence/${taskId}.closure-packet.json`,
    ...listExistingFilesRecursively(cwd, `.atm/history/task-events/${taskId}`),
    ...extractBackendStageFiles(backendResult)
  ]);
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

function resolvePlanningRosterPaths(input: {
  cwd: string;
  planningMirrorPath: string | null;
  rosterIndexPath: string | null;
}): { repoRoot: string | null; fromPath: string | null; indexPath: string | null; reason: string | null } {
  const planning = resolvePlanningPath(input.cwd, input.planningMirrorPath);
  if (!planning.repoRoot || !planning.relativePath) {
    return {
      repoRoot: null,
      fromPath: null,
      indexPath: null,
      reason: planning.reason
    };
  }
  return {
    repoRoot: planning.repoRoot,
    fromPath: planning.relativePath,
    indexPath: input.rosterIndexPath
      ? normalizeRepoRelativePath(planning.repoRoot, path.isAbsolute(input.rosterIndexPath)
        ? input.rosterIndexPath
        : path.resolve(planning.repoRoot, input.rosterIndexPath))
      : null,
    reason: null
  };
}

function buildTaskflowCommitBundle(input: {
  cwd: string;
  taskId: string;
  actorId: string | null;
  commitMode: TaskflowCommitMode;
  planningMirrorPath: string | null;
  rosterIndexPath: string | null;
  backendResult?: Record<string, unknown> | null;
}): TaskflowGovernedCommitBundle {
  const targetRepoRoot = path.resolve(input.cwd);
  const targetStageFiles = buildTargetStageFiles(targetRepoRoot, input.taskId, input.backendResult ?? null);
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
  const targetMessage = `chore(taskflow): close ${input.taskId} target governance bundle`;
  const planningMessage = `docs(taskflow): close ${input.taskId} planning bundle`;
  const failClosed = targetStageFiles.length === 0 || !planning.repoRoot || planningStageFiles.length === 0;

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
      reason: targetStageFiles.length > 0 ? null : 'target close artifact paths could not be computed'
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
    recoveryCommand: null
  };
}

function assertCommitBundleReady(bundle: TaskflowGovernedCommitBundle) {
  if (bundle.failClosed || !bundle.targetRepo.repoRoot || !bundle.planningRepo.repoRoot) {
    throw new CliError('ATM_TASKFLOW_CLOSE_COMMIT_BUNDLE_INCOMPLETE', 'taskflow close cannot compute the dual-repo governed commit bundle.', {
      exitCode: 1,
      details: { governedCommitBundle: bundle }
    });
  }
}

function stageRepoBundle(repo: TaskflowCommitRepoBundle): TaskflowCommitRepoBundle {
  if (!repo.repoRoot || repo.stageFiles.length === 0) {
    return { ...repo, status: 'uncomputed' };
  }
  const existingFiles = repo.stageFiles.filter((file) => existsSync(path.resolve(repo.repoRoot ?? '', file)));
  if (existingFiles.length === 0) {
    return { ...repo, stageFiles: existingFiles, status: 'skipped', reason: 'no existing bundle files to stage' };
  }
  runGitOrThrow(repo.repoRoot, ['add', '--', ...existingFiles]);
  return { ...repo, stageFiles: existingFiles, status: 'staged' };
}

async function commitTaskflowBundle(input: {
  bundle: TaskflowGovernedCommitBundle;
  actorId: string;
  taskId: string;
}): Promise<TaskflowGovernedCommitBundle> {
  const targetResult = await runAtmGit([
    'commit',
    '--cwd', input.bundle.targetRepo.repoRoot ?? '',
    '--actor', input.actorId,
    '--task', input.taskId,
    '--message', input.bundle.targetRepo.commitMessage,
    '--json'
  ]);
  const targetCommitSha = String((targetResult.evidence as Record<string, unknown>)?.commitSha ?? '') || null;
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
    const planningMessage = [
      planningRepo.commitMessage,
      '',
      `ATM-Actor: ${input.actorId}`,
      `ATM-Task: ${input.taskId}`,
      'ATM-Surface: taskflow-close-planning-bundle'
    ].join('\n');
    runGitOrThrow(planningRepo.repoRoot, ['commit', '-m', planningMessage]);
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
      recoveryCommand: planningRepo.commitCommand || null
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

async function finalizeTaskflowCommitBundle(input: {
  bundle: TaskflowGovernedCommitBundle;
  actorId: string;
  taskId: string;
}): Promise<TaskflowGovernedCommitBundle> {
  assertCommitBundleReady(input.bundle);
  const stagedTarget = stageRepoBundle(input.bundle.targetRepo);
  const stagedPlanning = stageRepoBundle(input.bundle.planningRepo);
  const stagedBundle: TaskflowGovernedCommitBundle = {
    ...input.bundle,
    targetRepo: stagedTarget,
    planningRepo: stagedPlanning
  };
  if (input.bundle.commitMode === 'stage-only') {
    return stagedBundle;
  }
  return commitTaskflowBundle({
    bundle: stagedBundle,
    actorId: input.actorId,
    taskId: input.taskId
  });
}

async function runTaskflowClose(parsed: ReturnType<typeof parseArgsForCommand>, cwd: string) {
  const taskId = parsed.options.task ? String(parsed.options.task) : '';
  const actorId = parsed.options.actor ? String(parsed.options.actor) : '';
  const writeRequested = !!parsed.options.write;
  const noCommitRequested = !!parsed.options.noCommit;
  const commitMode: TaskflowCommitMode = writeRequested
    ? noCommitRequested ? 'stage-only' : 'auto-commit'
    : 'dry-run';
  const profilePath = parsed.options.profile ? String(parsed.options.profile) : null;
  const historicalDeliveryRefs = collectHistoricalDeliveryRefs(parsed);

  if (!taskId) {
    throw new CliError('ATM_CLI_USAGE', 'taskflow close requires --task <work-item-id>.', { exitCode: 2 });
  }

  let profileData: TaskflowProfileV1 | null = null;
  if (profilePath) {
    profileData = loadProfile(profilePath);
  }
  const delegationContract = buildDelegationContract(profileData);
  const { taskDocument } = loadTaskDocumentOrThrow(cwd, taskId);
  const diagnosis = buildResidueDiagnosisEvidence(cwd, taskId, taskDocument);
  const closebackPlan = buildClosebackPlan({
    taskId,
    actorId: actorId || '<actor>',
    historicalDeliveryRefs,
    delegationContract,
    diagnosis: {
      bucket: diagnosis.bucket,
      truth: diagnosis.truth,
      residue: diagnosis.residue,
      reason: diagnosis.reason,
      nextCommand: diagnosis.nextCommand,
      triangulation: diagnosis.triangulation
    }
  });
  const diagnostics = buildTaskflowCloseDiagnostics({
    closeMode: closebackPlan.closeMode,
    writeRequested,
    actorSupplied: actorId.length > 0,
    taskIdSupplied: taskId.length > 0
  });
  const writeSupport = resolveCloseWriteSupport({
    writeRequested,
    closeMode: closebackPlan.closeMode,
    actorSupplied: actorId.length > 0,
    taskIdSupplied: taskId.length > 0,
    historicalDeliveryGateRequired: closebackPlan.historicalDeliveryGate.required,
    historicalDeliverySupplied: historicalDeliveryRefs.length > 0
  });

  if (writeRequested && !writeSupport.allowed) {
    throw new CliError(
      closebackPlan.closeMode === 'ambiguous-manual-review'
        ? 'ATM_TASKFLOW_CLOSE_AMBIGUOUS_RESIDUE'
        : 'ATM_TASKFLOW_CLOSE_WRITE_BLOCKED',
      writeSupport.reason,
      {
        exitCode: 1,
        details: {
          closeMode: closebackPlan.closeMode,
          writeSupport,
          diagnostics,
          closebackPlan,
          recommendedCommand: diagnosis.nextCommand
        }
      }
    );
  }

  const previewCommitBundle = buildTaskflowCommitBundle({
    cwd,
    taskId,
    actorId: actorId || null,
    commitMode,
    planningMirrorPath: closebackPlan.writerBoundary.planningMirrorPath,
    rosterIndexPath: closebackPlan.writerBoundary.rosterSyncPolicy === 'inline'
      ? closebackPlan.writerBoundary.rosterIndexPath
      : null
  });

  if (writeRequested) {
    assertCommitBundleReady(previewCommitBundle);
  }

  if (writeRequested && writeSupport.allowed) {
    const backendArgv = buildCloseBackendArgv({
      cwd,
      taskId,
      actorId,
      backendSurface: closebackPlan.backendSurface,
      historicalDeliveryRefs,
      planningMirrorPath: closebackPlan.writerBoundary.planningMirrorPath,
      forceImport: diagnosis.bucket === 'stale-import'
    });
    const backendResult = await runTasks(backendArgv);
    let rosterCloseback: Record<string, unknown> | null = null;
    if (
      closebackPlan.writerBoundary.rosterClosebackCommand
      && closebackPlan.writerBoundary.rosterSyncPolicy === 'inline'
      && closebackPlan.writerBoundary.rosterIndexPath
      && closebackPlan.writerBoundary.planningMirrorPath
    ) {
      const planningRosterPaths = resolvePlanningRosterPaths({
        cwd,
        planningMirrorPath: closebackPlan.writerBoundary.planningMirrorPath,
        rosterIndexPath: closebackPlan.writerBoundary.rosterIndexPath
      });
      if (!planningRosterPaths.repoRoot || !planningRosterPaths.indexPath || !planningRosterPaths.fromPath) {
        throw new CliError('ATM_TASKFLOW_CLOSE_PLANNING_ROSTER_UNRESOLVED', planningRosterPaths.reason ?? 'taskflow close could not resolve planning roster paths.', {
          exitCode: 1,
          details: { closebackPlan }
        });
      }
      rosterCloseback = {
        mode: 'inline',
        command: closebackPlan.writerBoundary.rosterClosebackCommand,
        result: await runTasksRosterUpdate([
          '--cwd', planningRosterPaths.repoRoot,
          '--index', planningRosterPaths.indexPath,
          '--from', planningRosterPaths.fromPath
        ])
      };
    } else if (
      closebackPlan.writerBoundary.rosterClosebackCommand
      && closebackPlan.writerBoundary.rosterSyncPolicy === 'follow-up-command'
    ) {
      rosterCloseback = {
        mode: 'follow-up-command',
        command: closebackPlan.writerBoundary.rosterClosebackCommand
      };
    }
    const governedCommitBundle = await finalizeTaskflowCommitBundle({
      bundle: buildTaskflowCommitBundle({
        cwd,
        taskId,
        actorId,
        commitMode,
        planningMirrorPath: closebackPlan.writerBoundary.planningMirrorPath,
        rosterIndexPath: closebackPlan.writerBoundary.rosterSyncPolicy === 'inline'
          ? closebackPlan.writerBoundary.rosterIndexPath
          : null,
        backendResult: backendResult as unknown as Record<string, unknown>
      }),
      actorId,
      taskId
    });

    return {
      ...makeResult({
        ok: backendResult.ok,
        command: 'taskflow close',
        cwd,
        mode: 'write',
        messages: [
          message(
            backendResult.ok ? 'info' : 'error',
            backendResult.ok ? 'ATM_TASKFLOW_CLOSE_WRITE_ORCHESTRATED' : 'ATM_TASKFLOW_CLOSE_WRITE_FAILED',
            backendResult.ok
              ? `taskflow close orchestrated ${closebackPlan.backendSurface} for ${taskId}.`
              : `taskflow close write failed for ${taskId}.`,
            { closeMode: closebackPlan.closeMode, backendSurface: closebackPlan.backendSurface }
          )
        ],
        evidence: {
          closeMode: closebackPlan.closeMode,
          writeSupport,
          commitMode,
          delegationContract,
          diagnostics,
          closebackPlan,
          backendResult,
          rosterCloseback,
          governedCommitBundle,
          residueDiagnosis: diagnosis,
          ...(profileData ? { profile: profileData } : {})
        }
      }),
      schemaId: 'atm.taskflowCloseResult.v1',
      writeEnabled: true
    };
  }

  return {
    ...makeResult({
      ok: true,
      command: 'taskflow close',
      cwd,
      mode: 'dry-run',
      messages: [
        message(
          closebackPlan.closeMode === 'ambiguous-manual-review' ? 'warn' : 'info',
          closebackPlan.closeMode === 'ambiguous-manual-review'
            ? 'ATM_TASKFLOW_CLOSE_AMBIGUOUS_RESIDUE'
            : 'ATM_TASKFLOW_CLOSE_ORCHESTRATION_READY',
          closebackPlan.closeMode === 'ambiguous-manual-review'
            ? 'taskflow close dry-run blocked on ambiguous residue; operator review required.'
            : `taskflow close dry-run plan is ready (${closebackPlan.closeMode}).`,
          { taskId, closeMode: closebackPlan.closeMode }
        )
      ],
      evidence: {
        closeMode: closebackPlan.closeMode,
        commitMode,
        writeSupport,
        delegationContract,
        diagnostics,
        closebackPlan,
        governedCommitBundle: previewCommitBundle,
        residueDiagnosis: diagnosis,
        ...(profileData ? { profile: profileData } : {})
      }
    }),
    schemaId: 'atm.taskflowCloseResult.v1',
    writeEnabled: false
  };
}

export async function runTaskflow(argv: string[] = []) {
  const spec = getCommandSpec('taskflow');
  if (!spec) {
    throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for taskflow.', { exitCode: 2 });
  }
  const parsed = parseArgsForCommand(spec, argv);
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));

  const action = parsed.positional[0];
  if (action === 'close') {
    return runTaskflowClose(parsed, cwd);
  }
  if (action !== 'open') {
    throw new CliError('ATM_CLI_USAGE', `Unknown taskflow action: ${action}. Supported actions: open, close.`, { exitCode: 2 });
  }

  const writeRequested = !!parsed.options.write;
  const profilePath = parsed.options.profile ? String(parsed.options.profile) : null;
  const taskId = parsed.options.taskId ? String(parsed.options.taskId) : null;
  const outputPath = parsed.options.output ? String(parsed.options.output) : null;
  const rosterIndexPath = parsed.options.rosterIndex ? String(parsed.options.rosterIndex) : null;
  const template = parsed.options.template ? String(parsed.options.template) : 'aao-l2-split';
  const title = parsed.options.title ? String(parsed.options.title) : 'New Task';

  let profileData: TaskflowProfileV1 | null = null;
  if (profilePath) {
    profileData = loadProfile(profilePath);
  }
  const openOutputRoot = resolveTaskflowOpenOutputRoot({
    profilePath,
    profile: profileData,
    cwd
  });

  const prerequisiteInput = {
    profile: profileData,
    taskIdSupplied: taskId !== null,
    outputPathSupplied: outputPath !== null,
    writeRequested
  };

  const delegationContract = buildDelegationContract(profileData);
  const openerMode = resolveOpenerMode(prerequisiteInput);
  const writeSupport = resolveWriteSupport(prerequisiteInput);
  const diagnostics = buildTaskflowOpenDiagnostics(prerequisiteInput);

  let hostPolicyDecision: ReturnType<typeof resolveHostOpenerPolicyDecision> | null = null;
  if (profileData && canResolveHostOpenerPolicy({
    cwd: openOutputRoot,
    profile: profileData,
    delegationContract,
    taskId,
    outputPath,
    title
  })) {
    try {
      hostPolicyDecision = resolveHostOpenerPolicyDecision({
        cwd: openOutputRoot,
        profile: profileData,
        delegationContract,
        taskId,
        outputPath,
        title
      });
      diagnostics.messages.push(...hostPolicyDecision.diagnostics);
    } catch (error) {
      if (writeRequested || taskId || outputPath) {
        throw error;
      }
    }
  }

  const orchestrationPlan = buildOrchestrationPlan({
    profile: profileData,
    openerMode,
    delegationContract,
    outputRoot: openOutputRoot,
    taskId: hostPolicyDecision?.taskId ?? taskId,
    outputPath: hostPolicyDecision?.outputPath ?? outputPath,
    template,
    title,
    rosterIndexPath,
    hostPolicyDecision
  });

  if (writeRequested && !writeSupport.allowed) {
    throw new CliError(
      'ATM_TASKFLOW_TEMPLATE_ONLY_FALLBACK',
      openerMode === 'template-only-fallback'
        ? 'taskflow open --write is not available in template-only-fallback mode. Load an invocable host opener profile or use tasks new for explicit template generation.'
        : 'taskflow open --write prerequisites are incomplete. Supply --task-id/--output or configure host-opener numbering and output-path policy.',
      {
        exitCode: 1,
        details: {
          openerMode,
          writeSupport,
          delegationContract,
          diagnostics,
          orchestrationPlan,
          recommendedCommand: buildTasksNewCommand({
            taskId: hostPolicyDecision?.taskId ?? taskId,
            outputPath: hostPolicyDecision?.outputPath ?? outputPath,
            template,
            title
          })
        }
      }
    );
  }

  if (writeRequested && writeSupport.allowed) {
    if (!profileData) {
      throw new CliError('ATM_TASKFLOW_TEMPLATE_ONLY_FALLBACK', 'taskflow open --write requires a governed profile.', { exitCode: 1 });
    }

    const resolved = hostPolicyDecision ?? resolveHostOpenerPolicyDecision({
      cwd: openOutputRoot,
      profile: profileData,
      delegationContract,
      taskId,
      outputPath,
      title
    });

    const targetAbsolute = resolveOutputAbsolute(openOutputRoot, resolved.outputPath);
    const hadExistingTarget = existsSync(targetAbsolute);
    let generated: Awaited<ReturnType<typeof generateTaskCard>> | null = null;
    if (!hadExistingTarget) {
      generated = await generateTaskCard({
        cwd: openOutputRoot,
        templateKey: template,
        taskId: resolved.taskId,
        title,
        outputPath: resolved.outputPath
      });
      mkdirSync(path.dirname(targetAbsolute), { recursive: true });
      writeFileSync(targetAbsolute, generated.content, 'utf8');
    }

    let runtimeImport: Record<string, unknown> | null = null;
    try {
      const runtimeImportResult = await runTasks([
        'import',
        '--cwd', cwd,
        '--from', targetAbsolute,
        '--write'
      ]);
      runtimeImport = {
        command: buildTasksImportCommand({ fromPath: targetAbsolute }),
        result: runtimeImportResult
      };
    } catch (error) {
      if (!hadExistingTarget && existsSync(targetAbsolute)) {
        rmSync(targetAbsolute, { force: true });
      }
      throw error;
    }

    const effectiveRosterIndex = rosterIndexPath ?? delegationContract.policy.rosterSync.indexPath;
    let rosterSync: Record<string, unknown> | null = null;
    if (delegationContract.policy.rosterSyncPolicy === 'inline' && effectiveRosterIndex) {
      const rosterResult = await runTasksRosterUpdate([
        '--cwd', cwd,
        '--index', effectiveRosterIndex,
        '--from', resolved.outputPath
      ]);
      rosterSync = {
        mode: 'inline',
        command: buildRosterSyncCommand({ indexPath: effectiveRosterIndex, fromPath: resolved.outputPath }),
        result: rosterResult
      };
    } else if (delegationContract.policy.rosterSyncPolicy === 'follow-up-command' && effectiveRosterIndex) {
      rosterSync = {
        mode: 'follow-up-command',
        command: buildRosterSyncCommand({ indexPath: effectiveRosterIndex, fromPath: resolved.outputPath })
      };
    }

    return {
      ...makeResult({
        ok: true,
        command: 'taskflow open',
        cwd,
        mode: 'write',
        messages: [
          message(
            'info',
            'ATM_TASKFLOW_OPEN_WRITE_ORCHESTRATED',
            `taskflow open orchestrated tasks new generation at ${resolved.outputPath}.`,
            { openerMode, generationSurface: 'tasks-new', runtimeImported: true }
          )
        ],
        evidence: {
          openerMode,
          writeSupport,
          delegationContract,
          diagnostics,
          orchestrationPlan,
          hostPolicyDecision: resolved,
          generation: {
            surface: 'tasks-new',
            taskId: generated?.taskId ?? resolved.taskId,
            sourcePath: generated?.sourcePath ?? resolved.outputPath,
            templateUsed: generated?.templateUsed ?? template,
            reusedExistingCard: hadExistingTarget,
            outputRepoRoot: openOutputRoot
          },
          runtimeImport,
          rosterSync,
          ...(profileData ? { profile: profileData } : {})
        }
      }),
      schemaId: 'atm.taskflowOpenResult.v1',
      writeEnabled: true
    };
  }

  const result = makeResult({
    ok: true,
    command: 'taskflow open',
    cwd,
    mode: 'dry-run',
    messages: [
      message(
        openerMode === 'delegated-governed' ? 'info' : 'warn',
        openerMode === 'delegated-governed'
          ? 'ATM_TASKFLOW_OPEN_ORCHESTRATION_READY'
          : 'ATM_TASKFLOW_OPEN_TEMPLATE_ONLY_FALLBACK',
        openerMode === 'delegated-governed'
          ? 'taskflow open dry-run orchestration plan is ready for delegated governed entry.'
          : 'taskflow open is in template-only-fallback mode. tasks new remains the explicit low-level generator.',
        { cwd, openerMode }
      )
    ],
    evidence: {
      openerMode,
      writeSupport,
      delegationContract,
      diagnostics,
      orchestrationPlan,
      hostPolicyDecision,
      fallbackBehavior: delegationContract.policy.fallbackBehavior,
      ...(profileData ? { profile: profileData } : {})
    }
  });

  return {
    ...result,
    schemaId: 'atm.taskflowOpenResult.v1',
    writeEnabled: false
  };
}
