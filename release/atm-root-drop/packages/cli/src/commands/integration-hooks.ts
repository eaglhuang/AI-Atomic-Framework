import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const { existsSync, mkdirSync, readFileSync, readSync, writeFileSync } = fs;

type FsWithSetBlocking = typeof fs & {
  setBlocking?: (fd: number, blocking: boolean) => void;
};

function setStdinBlocking(blocking: boolean): void {
  const setBlocking = (fs as FsWithSetBlocking).setBlocking;
  if (typeof setBlocking === 'function') {
    setBlocking(0, blocking);
  }
}

function hasNonBlockingStdinSupport(): boolean {
  return typeof (fs as FsWithSetBlocking).setBlocking === 'function';
}

function readStdinBytes(scratch: Buffer): number {
  return readSync(0, scratch, 0, scratch.length, null);
}
import type { InstallManifest } from '../../../integrations-core/src/index.ts';
import {
  buildFrameworkTempClaimCommand,
  createFrameworkModeStatus,
  detectFrameworkRepoIdentity,
  isAtmCriticalNonDocSurface
} from './framework-development.ts';
import { isPlanningMirrorPath, isTaskDirectionPathCandidate, readActiveTaskDirectionLocks } from './task-direction.ts';
import { extractPathLikeStringsFromPrompt, isPathAllowedByScope, isQuickfixPrompt, readActiveQuickfixLock } from './work-channels.ts';
import {
  hookContractVersion,
  hookMarker,
  hookProvider,
  inspectGitHooks,
  installGitHooks
} from './hook.ts';
import { resolvePromptScopedTaskContext } from './next.ts';
import { CliError, makeResult, message, relativePathFrom } from './shared.ts';

export type HookIntegrationId = 'copilot' | 'claude-code' | 'cursor' | 'gemini' | 'codex' | 'antigravity';
export type IntegrationHookAction = 'pre-agent' | 'pre-tool';

interface InstallEditorHooksOptions {
  readonly dryRun?: boolean;
  readonly force?: boolean;
}

interface HookInvocationOptions {
  readonly cwd: string;
  readonly editor: string;
  readonly event: IntegrationHookAction;
  readonly prompt: string | null;
  readonly toolName: string | null;
  readonly command: string | null;
  readonly files: readonly string[];
  readonly targetRepo: string | null;
  readonly stdinPayload: unknown;
}

const adapterHookEvents: Record<string, readonly string[]> = {
  copilot: ['sessionStart', 'userPromptSubmitted', 'preToolUse'],
  'claude-code': ['UserPromptSubmit', 'PreToolUse', 'Stop'],
  cursor: [],
  gemini: [],
  codex: [],
  antigravity: []
};

/** Poll window for piped hook stdin when data may arrive shortly after process start. */
const HOOK_STDIN_POLL_MS = 50;
const HOOK_STDIN_CHUNK_BYTES = 64 * 1024;
const hookStdinSleepBuffer = new Int32Array(new SharedArrayBuffer(4));

export function runIntegrationHookInvocation(argv: string[]) {
  const options = parseHookInvocationArgs(argv);
  if (options.event === 'pre-agent') {
    return runPreAgentHook(options);
  }
  return runPreToolHook(options);
}

/** In-process validators inherit idle stdin pipes; opt out explicitly instead of reading. */
export function runIntegrationHookInvocationInProcess(argv: string[]) {
  return runIntegrationHookInvocation(['--no-stdin', ...argv]);
}

export function installEditorIntegrationHooks(cwd: string, adapterId: string, options: InstallEditorHooksOptions = {}) {
  const root = path.resolve(cwd);
  const repoIdentity = detectFrameworkRepoIdentity(root);
  const normalizedAdapterId = normalizeAdapterId(adapterId);
  if (normalizedAdapterId !== 'copilot' && normalizedAdapterId !== 'claude-code') {
    const report = {
      schemaId: 'atm.integrationHookInstallReport.v1',
      generatedAt: new Date().toISOString(),
      adapterId: normalizedAdapterId,
      supported: false,
      repoIdentity,
      writtenFiles: [],
      gitHooks: null,
      ok: repoIdentity.isFrameworkRepo ? false : true,
      reason: 'editor-hard-hooks-not-supported-by-adapter'
    };
    return report;
  }

  const hookFiles = normalizedAdapterId === 'copilot'
    ? createCopilotHookFiles()
    : createClaudeHookFiles(root);
  const writtenFiles = hookFiles.map((file) => file.path);
  if (options.dryRun !== true) {
    for (const file of hookFiles) {
      const absolutePath = path.join(root, file.path);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, file.content, 'utf8');
    }
    patchIntegrationManifestWithHookContract(root, normalizedAdapterId, writtenFiles);
  }
  const gitHooks = repoIdentity.isFrameworkRepo && options.dryRun !== true
    ? installGitHooks(root, { frameworkRequired: true })
    : inspectGitHooks(root, { frameworkRequired: repoIdentity.isFrameworkRepo });
  return {
    schemaId: 'atm.integrationHookInstallReport.v1',
    generatedAt: new Date().toISOString(),
    adapterId: normalizedAdapterId,
    supported: true,
    repoIdentity,
    writtenFiles,
    dryRun: options.dryRun === true,
    hookContractVersion,
    hookProvider,
    supportedHookEvents: adapterHookEvents[normalizedAdapterId],
    gitHooks,
    ok: options.dryRun === true ? true : verifyEditorIntegrationHooks(root, normalizedAdapterId).ok && gitHooks.ok
  };
}

export function verifyEditorIntegrationHooks(cwd: string, adapterId: string) {
  const root = path.resolve(cwd);
  const normalizedAdapterId = normalizeAdapterId(adapterId);
  const repoIdentity = detectFrameworkRepoIdentity(root);
  const supported = normalizedAdapterId === 'copilot' || normalizedAdapterId === 'claude-code';
  const hookFiles = supported
    ? normalizedAdapterId === 'copilot'
      ? ['.github/hooks/atm-framework-development.json']
      : ['.claude/settings.json']
    : [];
  const installedHookFiles = hookFiles.map((filePath) => inspectEditorHookFile(root, filePath, normalizedAdapterId));
  const manifest = readIntegrationManifestIfExists(root, normalizedAdapterId);
  const manifestHookContractOk = manifest
    ? manifest.hookContractVersion === hookContractVersion
      && manifest.hookProvider === hookProvider
      && Array.isArray(manifest.supportedHookEvents)
      && Array.isArray(manifest.installedHookFiles)
    : installedHookFiles.every((entry) => entry.present && entry.markerPresent);
  const gitHooks = inspectGitHooks(root, { frameworkRequired: repoIdentity.isFrameworkRepo });
  const editorHookFilesOk = supported && installedHookFiles.every((entry) => entry.present && entry.markerPresent);
  return {
    schemaId: 'atm.integrationHookVerifyReport.v1',
    generatedAt: new Date().toISOString(),
    adapterId: normalizedAdapterId,
    supported,
    repoIdentity,
    hookContractVersion,
    hookProvider,
    supportedHookEvents: adapterHookEvents[normalizedAdapterId] ?? [],
    installedHookFiles,
    manifestHookContractOk,
    gitHooks,
    ok: repoIdentity.isFrameworkRepo
      ? supported && editorHookFilesOk && manifestHookContractOk && gitHooks.ok
      : true
  };
}

export function inspectFrameworkHookReadiness(cwd: string) {
  const root = path.resolve(cwd);
  const repoIdentity = detectFrameworkRepoIdentity(root);
  const gitHooks = inspectGitHooks(root, { frameworkRequired: repoIdentity.isFrameworkRepo });
  const editorHooks = ['copilot', 'claude-code'].map((adapterId) => verifyEditorIntegrationHooks(root, adapterId));
  const anyEditorHookOk = editorHooks.some((entry) => entry.ok);
  return {
    schemaId: 'atm.frameworkHookReadiness.v1',
    generatedAt: new Date().toISOString(),
    repoIdentity,
    required: repoIdentity.isFrameworkRepo,
    gitHooks,
    editorHooks,
    ok: repoIdentity.isFrameworkRepo ? gitHooks.ok && anyEditorHookOk : true
  };
}

export function makeIntegrationHookInstallResult(cwd: string, adapterId: string, options: InstallEditorHooksOptions = {}) {
  const report = installEditorIntegrationHooks(cwd, adapterId, options);
  return makeResult({
    ok: report.ok,
    command: 'integration',
    cwd,
    messages: [
      report.ok
        ? message('info', 'ATM_INTEGRATION_HOOKS_INSTALLED', `Integration hooks installed for ${adapterId}.`, report)
        : message('error', 'ATM_INTEGRATION_HOOKS_INSTALL_FAILED', `Integration hooks could not be installed for ${adapterId}.`, report)
    ],
    evidence: {
      action: 'hooks install',
      report
    }
  });
}

export function makeIntegrationHookVerifyResult(cwd: string, adapterId: string) {
  const report = verifyEditorIntegrationHooks(cwd, adapterId);
  return makeResult({
    ok: report.ok,
    command: 'integration',
    cwd,
    messages: [
      report.ok
        ? message('info', 'ATM_INTEGRATION_HOOKS_VERIFY_OK', `Integration hooks verified for ${adapterId}.`, report)
        : message('error', 'ATM_INTEGRATION_HOOKS_VERIFY_FAILED', `Integration hooks are missing or drifted for ${adapterId}.`, report)
    ],
    evidence: {
      action: 'hooks verify',
      report
    }
  });
}

function runPreAgentHook(options: HookInvocationOptions) {
  const status = createFrameworkModeStatus({ cwd: options.cwd, targetRepo: options.targetRepo });
  const promptText = options.prompt ?? stringifyPayload(options.stdinPayload);
  const promptSignals = extractPromptSignals(promptText);
  const taskIntentDetected = promptSignals.some((entry) => entry.startsWith('prompt:task'));
  const frameworkSignal = status.mode !== 'inactive'
    || ((status.repoIdentity.isFrameworkRepo || status.targetRepoIdentity?.isFrameworkRepo === true) && promptSignals.length > 0);
  const promptNextCommand = promptText.trim().length > 0
    ? `node atm.mjs next --prompt ${quoteHookCliValue(promptText)} --json`
    : 'node atm.mjs next --prompt "<current user prompt>" --json';
  return makeResult({
    ok: true,
    command: 'integration',
    cwd: options.cwd,
    messages: [
      taskIntentDetected
        ? message('info', 'ATM_TASK_INTENT_DETECTED', 'The prompt appears to reference ATM task cards; run prompt-scoped next before any task or source edits.', {
          editor: options.editor,
          requiredNextStep: promptNextCommand,
          promptSignals
        })
        : null,
      frameworkSignal
        ? message('warning', 'ATM_INTEGRATION_PRE_AGENT_FRAMEWORK_CONTEXT', 'ATM framework-development context is active or suspected; claim governed work before modifying critical framework files.', {
          editor: options.editor,
          mode: status.mode,
          promptSignals,
          requiredNextStep: promptNextCommand
        })
        : message('info', 'ATM_INTEGRATION_PRE_AGENT_NO_HARD_GATE', 'No ATM framework-development hard gate is required before the agent response.', {
          editor: options.editor,
          repoRole: status.repoRole
        })
    ].filter((entry): entry is ReturnType<typeof message> => entry !== null),
    evidence: {
      action: 'hook pre-agent',
      editor: options.editor,
      promptSignals,
      promptScopedNextCommand: promptNextCommand,
      frameworkStatus: status,
      instructions: frameworkSignal ? frameworkDevelopmentInstructions() : []
    }
  });
}

function runPreToolHook(options: HookInvocationOptions) {
  const toolFiles = uniqueSorted([
    ...options.files,
    ...extractFilesFromPayload(options.stdinPayload),
    ...extractFilesFromCommand(options.command ?? '')
  ]);
  const toolCommand = options.command ?? extractCommandFromPayload(options.stdinPayload);
  const gitCommitIntent = /\bgit(?:\.exe)?\s+commit\b/i.test(toolCommand ?? '');
  const status = createFrameworkModeStatus({ cwd: options.cwd, files: toolFiles, targetRepo: options.targetRepo });
  const frameworkRoot = status.targetRepoIdentity?.isFrameworkRepo && status.targetRepo
    ? status.targetRepo
    : status.repoIdentity.isFrameworkRepo
      ? options.cwd
      : null;
  const mutatingIntent = isMutatingToolIntent(options.toolName, toolCommand);
  const criticalFiles = frameworkRoot
    ? toolFiles.map((entry) => normalizePathForFrameworkRoot(entry, frameworkRoot)).filter(isAtmCriticalNonDocSurface)
    : [];
  const protectedStateFiles = mutatingIntent && !gitCommitIntent
    ? toolFiles.map((entry) => normalizePathForRepoRoot(entry, options.cwd)).filter(isProtectedAtmManagedStatePath)
    : [];
  const runtimeLockFiles = mutatingIntent && !gitCommitIntent
    ? toolFiles.map((entry) => normalizePathForRepoRoot(entry, options.cwd)).filter(isRuntimeLockStatePath)
    : [];
  const planningClosureFiles = status.mode === 'cross-repo-target-required' && isMutatingToolIntent(options.toolName, toolCommand)
    ? toolFiles.map((entry) => normalizePathForRepoRoot(entry, options.cwd)).filter(isPlanningClosureSurface)
    : [];
  const hasFrameworkClaim = status.activeLocks.some((entry) => !entry.includes('/BOOTSTRAP-'));
  const gitHooks = inspectGitHooks(frameworkRoot ?? options.cwd, { frameworkRequired: frameworkRoot !== null });
  const promptScopedContext = resolvePromptScopedTaskContext(options.cwd, { prompt: options.prompt });
  const promptScope = promptScopedContext.promptScope;
  const activeQuickfixLock = readActiveQuickfixLock(options.cwd);
  const quickfixAllowedPaths = activeQuickfixLock?.allowedFiles ?? [];
  const promptScopedHeadTasks = promptScope
    ? promptScope.status === 'queue'
      ? promptScope.selectedTasks.slice(0, 1)
      : promptScope.selectedTasks
    : [];
  const promptScopedAllowedPaths = promptScope
    ? buildPromptScopedAllowedPaths(promptScopedHeadTasks)
    : [];
  const promptScopedPlanningMirrorPaths = promptScope
    ? buildPromptScopedPlanningMirrorPaths(promptScopedHeadTasks)
    : [];
  const promptScopedAllowsPlanningMirror = promptScopedHeadTasks.some((task) => task.allowPlanningMirror === true);
  const activeDirectionLocks = readActiveTaskDirectionLocks(options.cwd);
  const directionLockAllowedPaths = uniqueSorted(activeDirectionLocks.flatMap((lock) => lock.allowedFiles));
  const directionLockPlanningMirrorPaths = uniqueSorted(activeDirectionLocks.flatMap((lock) => lock.planningMirrorPaths ?? []));
  const directionLockAllowsPlanningMirror = activeDirectionLocks.some((lock) => lock.allowPlanningMirror === true);
  const directionLockDriftFiles = mutatingIntent
    && !gitCommitIntent
    && activeDirectionLocks.length > 0
    && directionLockAllowedPaths.length > 0
      ? toolFiles
        .map((entry) => normalizePathForRepoRoot(entry, options.cwd))
        .filter((entry) => !isPromptScopeDriftExempt(entry))
        .filter((entry) => !isToolFileInPromptScope(entry, directionLockAllowedPaths))
      : [];
  const directionLockPlanningMirrorDriftFiles = mutatingIntent
    && !gitCommitIntent
    && activeDirectionLocks.length > 0
    && directionLockPlanningMirrorPaths.length > 0
    && !directionLockAllowsPlanningMirror
      ? toolFiles
        .map((entry) => normalizePathForRepoRoot(entry, options.cwd))
        .filter((entry) => !isPromptScopeDriftExempt(entry))
        .filter((entry) => isPlanningMirrorPath(entry, directionLockPlanningMirrorPaths))
      : [];
  const promptScopedClaimRequired = mutatingIntent
    && !gitCommitIntent
    && !activeQuickfixLock
    && activeDirectionLocks.length === 0
    && Boolean(promptScopedContext.taskIntent?.taskScopeMentioned)
    && (promptScope?.status === 'ready' || promptScope?.status === 'queue');
  const promptScopedQuickfixRequired = mutatingIntent
    && !gitCommitIntent
    && !activeQuickfixLock
    && activeDirectionLocks.length === 0
    && Boolean(options.prompt)
    && !Boolean(promptScopedContext.taskIntent?.taskScopeMentioned)
    && isQuickfixPrompt(options.prompt ?? '')
    && extractPathLikeStringsFromPrompt(options.prompt ?? '').length > 0;
  const promptScopeDriftFiles = mutatingIntent
    && !gitCommitIntent
    && activeDirectionLocks.length === 0
    && Boolean(promptScopedContext.taskIntent?.taskScopeMentioned)
    && (promptScope?.status === 'ready' || promptScope?.status === 'queue')
    && promptScopedAllowedPaths.length > 0
      ? toolFiles
        .map((entry) => normalizePathForRepoRoot(entry, options.cwd))
        .filter((entry) => !isPromptScopeDriftExempt(entry))
        .filter((entry) => !isToolFileInPromptScope(entry, promptScopedAllowedPaths))
      : [];
  const promptScopedPlanningMirrorDriftFiles = mutatingIntent
    && !gitCommitIntent
    && activeDirectionLocks.length === 0
    && Boolean(promptScopedContext.taskIntent?.taskScopeMentioned)
    && (promptScope?.status === 'ready' || promptScope?.status === 'queue')
    && promptScopedPlanningMirrorPaths.length > 0
    && !promptScopedAllowsPlanningMirror
      ? toolFiles
        .map((entry) => normalizePathForRepoRoot(entry, options.cwd))
        .filter((entry) => !isPromptScopeDriftExempt(entry))
        .filter((entry) => isPlanningMirrorPath(entry, promptScopedPlanningMirrorPaths))
      : [];
  const quickfixDriftFiles = mutatingIntent
    && !gitCommitIntent
    && Boolean(activeQuickfixLock)
    && quickfixAllowedPaths.length > 0
      ? toolFiles
        .map((entry) => normalizePathForRepoRoot(entry, options.cwd))
        .filter((entry) => !isPromptScopeDriftExempt(entry))
        .filter((entry) => !isPathAllowedByScope(entry, quickfixAllowedPaths))
      : [];
  const staticEvidenceArtifactFiles = mutatingIntent && !gitCommitIntent
    ? toolFiles.map((entry) => normalizePathForRepoRoot(entry, options.cwd)).filter(isStaticEvidenceArtifactPath)
    : [];

  if (status.mode === 'cross-repo-target-required' && gitCommitIntent) {
    return makeResult({
      ok: false,
      command: 'integration',
      cwd: options.cwd,
      messages: [message('error', 'ATM_INTEGRATION_PRE_TOOL_TARGET_REPO_COMMIT_BLOCKED', 'Git commit is blocked in the planning repository while ATM framework closure authority belongs to the target repository.', {
        editor: options.editor,
        targetRepo: status.targetRepo,
        nextStep: status.targetRepo ? `cd "${status.targetRepo}" ; node atm.mjs next --claim --actor <id> --json` : 'node atm.mjs next --json'
      })],
      evidence: {
        action: 'hook pre-tool',
        editor: options.editor,
        toolName: options.toolName,
        toolFiles,
        gitCommitIntent,
        frameworkStatus: status
      }
    });
  }

  if (gitCommitIntent && status.repoIdentity.isFrameworkRepo && !gitHooks.ok) {
    return makeResult({
      ok: false,
      command: 'integration',
      cwd: options.cwd,
      messages: [message('error', 'ATM_INTEGRATION_PRE_TOOL_GIT_HOOK_MISSING', 'Git commit is blocked because ATM framework Git hooks are missing or drifted.', {
        editor: options.editor,
        installCommand: 'node atm.mjs integration hooks install <editor-id> --json'
      })],
      evidence: {
        action: 'hook pre-tool',
        editor: options.editor,
        toolName: options.toolName,
        gitCommitIntent,
        gitHooks,
        frameworkStatus: status
      }
    });
  }

  if (planningClosureFiles.length > 0) {
    return makeResult({
      ok: false,
      command: 'integration',
      cwd: options.cwd,
      messages: [message('error', 'ATM_INTEGRATION_PRE_TOOL_TARGET_REPO_CLOSURE_REQUIRED', 'Planning repository task/evidence edits are blocked because ATM framework closure authority belongs to the target repository.', {
        editor: options.editor,
        blockedFiles: planningClosureFiles,
        targetRepo: status.targetRepo,
        nextStep: status.targetRepo ? `cd "${status.targetRepo}" ; node atm.mjs next --claim --actor <id> --json` : 'node atm.mjs next --json'
      })],
      evidence: {
        action: 'hook pre-tool',
        editor: options.editor,
        toolName: options.toolName,
        toolFiles,
        blockedFiles: planningClosureFiles,
        frameworkStatus: status
      }
    });
  }

  if (runtimeLockFiles.length > 0 && !isAuthorizedRuntimeLockMutationCommand(toolCommand)) {
    return makeResult({
      ok: false,
      command: 'integration',
      cwd: options.cwd,
      messages: [message('error', 'ATM_RUNTIME_LOCK_MANUAL_EDIT_BLOCKED', 'Manual edits to .atm/runtime/locks/** are blocked. Runtime locks must be changed only by ATM CLI lifecycle commands.', {
        editor: options.editor,
        blockedFiles: runtimeLockFiles,
        requiredCommand: 'node atm.mjs next --claim --actor <id> --prompt "<current user prompt>" --json',
        nextStep: 'If a lock is stale, use node atm.mjs tasks lock cleanup ... or node atm.mjs lock release ... instead of editing lock JSON.'
      })],
      evidence: {
        action: 'hook pre-tool',
        editor: options.editor,
        toolName: options.toolName,
        toolFiles,
        blockedFiles: runtimeLockFiles,
        toolCommand,
        frameworkStatus: status
      }
    });
  }

  if (protectedStateFiles.length > 0 && !isAuthorizedAtmStateMutationCommand(toolCommand)) {
    return makeResult({
      ok: false,
      command: 'integration',
      cwd: options.cwd,
      messages: [message('error', 'ATM_PROTECTED_STATE_MANUAL_EDIT_BLOCKED', 'ATM protected runtime/task/evidence state must be mutated through ATM CLI commands, not by direct file edits.', {
        editor: options.editor,
        blockedFiles: protectedStateFiles,
        nextStep: 'Use node atm.mjs next/tasks/evidence/framework-mode commands instead of editing .atm history or runtime state files directly.'
      })],
      evidence: {
        action: 'hook pre-tool',
        editor: options.editor,
        toolName: options.toolName,
        toolFiles,
        blockedFiles: protectedStateFiles,
        toolCommand,
        frameworkStatus: status
      }
    });
  }

  if (staticEvidenceArtifactFiles.length > 0 && !isAuthorizedStaticEvidenceArtifactCommand(toolCommand)) {
    return makeResult({
      ok: false,
      command: 'integration',
      cwd: options.cwd,
      messages: [message('error', 'ATM_STATIC_EVIDENCE_IMPERSONATION_BLOCKED', 'Do not hand-edit static evidence artifacts. Generate reports with ATM commands and record closure evidence through atm evidence/tasks commands.', {
        editor: options.editor,
        blockedFiles: staticEvidenceArtifactFiles,
        nextStep: 'Use node atm.mjs evidence add ... for closure proof, and generate report artifacts through atm/validator commands instead of direct file edits.'
      })],
      evidence: {
        action: 'hook pre-tool',
        editor: options.editor,
        toolName: options.toolName,
        toolFiles,
        blockedFiles: staticEvidenceArtifactFiles,
        toolCommand,
        frameworkStatus: status
      }
    });
  }

  if (quickfixDriftFiles.length > 0) {
    return makeResult({
      ok: false,
      command: 'integration',
      cwd: options.cwd,
      messages: [message('error', 'ATM_QUICKFIX_SCOPE_EXCEEDED', 'Tool edit scope drifted away from the active ATM quickfix lock.', {
        editor: options.editor,
        blockedFiles: quickfixDriftFiles,
        scopePaths: quickfixAllowedPaths.slice(0, 40),
        nextStep: 'Finish or release the active quickfix lock before editing unrelated files.'
      })],
      evidence: {
        action: 'hook pre-tool',
        editor: options.editor,
        toolName: options.toolName,
        toolFiles,
        quickfixDriftFiles,
        quickfixLock: activeQuickfixLock,
        frameworkStatus: status
      }
    });
  }

  if (directionLockPlanningMirrorDriftFiles.length > 0) {
    return makeResult({
      ok: false,
      command: 'integration',
      cwd: options.cwd,
      messages: [message('error', 'ATM_PLANNING_MIRROR_BLOCKED', 'Target-repo edits are trying to create or mutate a planning mirror path. Planning files stay read-only unless the task explicitly allows mirror/import work.', {
        editor: options.editor,
        blockedFiles: directionLockPlanningMirrorDriftFiles,
        planningReadOnlyPaths: uniqueSorted(activeDirectionLocks.flatMap((lock) => lock.planningReadOnlyPaths ?? [])).slice(0, 20),
        planningMirrorPaths: directionLockPlanningMirrorPaths.slice(0, 20),
        nextStep: 'Work only inside targetWork.allowedFiles, or add explicit allow_planning_mirror metadata for mirror/import tasks.'
      })],
      evidence: {
        action: 'hook pre-tool',
        editor: options.editor,
        toolName: options.toolName,
        toolFiles,
        directionLockPlanningMirrorDriftFiles,
        activeDirectionLocks,
        frameworkStatus: status
      }
    });
  }

  if (directionLockDriftFiles.length > 0) {
    return makeResult({
      ok: false,
      command: 'integration',
      cwd: options.cwd,
      messages: [message('error', 'ATM_TOOL_SCOPE_DRIFT_BLOCKED', 'Tool edit scope drifted away from the active ATM task direction lock.', {
        editor: options.editor,
        blockedFiles: directionLockDriftFiles,
        activeTaskIds: activeDirectionLocks.map((lock) => lock.taskId),
        scopePaths: directionLockAllowedPaths.slice(0, 40),
        nextStep: 'Finish or release the active task direction lock before editing unrelated files.'
      })],
      evidence: {
        action: 'hook pre-tool',
        editor: options.editor,
        toolName: options.toolName,
        toolFiles,
        directionLockDriftFiles,
        activeDirectionLocks,
        frameworkStatus: status
      }
    });
  }

  if (promptScopedQuickfixRequired) {
    const requiredCommand = `node atm.mjs next --claim --actor <id> --prompt ${quoteHookCliValue(options.prompt ?? '<current user prompt>')} --json`;
    return makeResult({
      ok: false,
      command: 'integration',
      cwd: options.cwd,
      messages: [message('error', 'ATM_CHANNEL_REQUIRED', 'This looks like a small targeted fix; let ATM establish the fast quickfix channel before editing.', {
        editor: options.editor,
        nextStep: requiredCommand
      })],
      evidence: {
        action: 'hook pre-tool',
        editor: options.editor,
        toolName: options.toolName,
        toolFiles,
        requiredCommand,
        frameworkStatus: status
      }
    });
  }

  if (promptScopedClaimRequired) {
    const requiredCommand = `node atm.mjs next --claim --actor <id> --prompt ${quoteHookCliValue(promptScopedContext.taskIntent?.userPrompt ?? options.prompt ?? '<current user prompt>')} --json`;
    return makeResult({
      ok: false,
      command: 'integration',
      cwd: options.cwd,
      messages: [message('error', 'ATM_TASK_DIRECTION_LOCK_REQUIRED', 'Prompt-scoped task work is blocked until ATM claims the selected task or queue head.', {
        editor: options.editor,
        selectedTaskIds: promptScope?.selectedTasks.map((task) => task.workItemId) ?? [],
        nextStep: requiredCommand
      })],
      evidence: {
        action: 'hook pre-tool',
        editor: options.editor,
        toolName: options.toolName,
        toolFiles,
        promptScopedContext,
        requiredCommand,
        frameworkStatus: status
      }
    });
  }

  if (promptScopedPlanningMirrorDriftFiles.length > 0) {
    return makeResult({
      ok: false,
      command: 'integration',
      cwd: options.cwd,
      messages: [message('error', 'ATM_PLANNING_MIRROR_BLOCKED', 'Prompt-scoped target work cannot create a local planning mirror directory. Planning context is read-only until a task explicitly declares mirror/import work.', {
        editor: options.editor,
        blockedFiles: promptScopedPlanningMirrorDriftFiles,
        selectedTaskIds: promptScope?.selectedTasks.map((task) => task.workItemId) ?? [],
        planningMirrorPaths: promptScopedPlanningMirrorPaths.slice(0, 20),
        nextStep: 'Stay inside targetWork.allowedFiles, or add explicit allow_planning_mirror metadata if this task really needs a planning mirror/import.'
      })],
      evidence: {
        action: 'hook pre-tool',
        editor: options.editor,
        toolName: options.toolName,
        toolFiles,
        promptScopedPlanningMirrorDriftFiles,
        promptScopedContext,
        promptScopedPlanningMirrorPaths,
        frameworkStatus: status
      }
    });
  }

  if (promptScopeDriftFiles.length > 0) {
    return makeResult({
      ok: false,
      command: 'integration',
      cwd: options.cwd,
      messages: [message('error', 'ATM_TOOL_SCOPE_DRIFT_BLOCKED', 'Tool edit scope drifted away from the prompt-scoped task route; narrow edits to the selected task scope or refine the prompt.', {
        editor: options.editor,
        blockedFiles: promptScopeDriftFiles,
        selectedTaskIds: promptScope?.selectedTasks.map((task) => task.workItemId) ?? [],
        scopePaths: promptScopedAllowedPaths.slice(0, 40),
        nextStep: 'node atm.mjs next --prompt "<more specific prompt with task id or plan path>" --json'
      })],
      evidence: {
        action: 'hook pre-tool',
        editor: options.editor,
        toolName: options.toolName,
        toolFiles,
        promptScopeDriftFiles,
        promptScopedContext,
        promptScopedAllowedPaths,
        frameworkStatus: status
      }
    });
  }

  if (criticalFiles.length > 0 && !hasFrameworkClaim) {
    const claimCommand = buildFrameworkTempClaimCommand(criticalFiles, 'temporary framework maintenance before tool edit');
    return makeResult({
      ok: false,
      command: 'integration',
      cwd: options.cwd,
      messages: [message('error', 'ATM_INTEGRATION_PRE_TOOL_FRAMEWORK_CLAIM_REQUIRED', 'Framework critical source edit is blocked until ATM framework work is claimed.', {
        editor: options.editor,
        criticalFiles,
        nextStep: claimCommand
      })],
      evidence: {
        action: 'hook pre-tool',
        editor: options.editor,
        toolName: options.toolName,
        toolFiles,
        criticalFiles,
        frameworkClaimCommand: claimCommand,
        frameworkStatus: status
      }
    });
  }

  return makeResult({
    ok: true,
    command: 'integration',
    cwd: options.cwd,
    messages: [message('info', gitCommitIntent ? 'ATM_INTEGRATION_PRE_TOOL_DEFER_TO_GIT_HOOK' : 'ATM_INTEGRATION_PRE_TOOL_OK', gitCommitIntent
      ? 'Git commit intent detected; repository Git hook will run the full pre-commit gate.'
      : 'ATM pre-tool hook passed.', {
        editor: options.editor,
        criticalFiles,
        gitCommitIntent
      })],
    evidence: {
      action: 'hook pre-tool',
      editor: options.editor,
      toolName: options.toolName,
      toolFiles,
      criticalFiles,
      gitCommitIntent,
      activeDirectionLocks,
      frameworkStatus: status,
      gitHooks
    }
  });
}

function parseHookInvocationArgs(argv: string[]): HookInvocationOptions {
  const skipStdin = shouldSkipHookStdin(argv);
  const state = {
    cwd: process.cwd(),
    event: null as IntegrationHookAction | null,
    editor: null as string | null,
    prompt: null as string | null,
    toolName: null as string | null,
    command: null as string | null,
    files: [] as string[],
    targetRepo: null as string | null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      state.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--editor') {
      state.editor = requireValue(argv, index, '--editor');
      index += 1;
      continue;
    }
    if (arg === '--prompt') {
      state.prompt = requireValue(argv, index, '--prompt');
      index += 1;
      continue;
    }
    if (arg === '--tool-name') {
      state.toolName = requireValue(argv, index, '--tool-name');
      index += 1;
      continue;
    }
    if (arg === '--command') {
      state.command = requireValue(argv, index, '--command');
      index += 1;
      continue;
    }
    if (arg === '--files') {
      state.files = requireValue(argv, index, '--files').split(',').map(normalizeRelativePath).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--target-repo') {
      state.targetRepo = requireValue(argv, index, '--target-repo');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty' || arg === '--no-stdin') continue;
    if (arg !== 'pre-agent' && arg !== 'pre-tool') {
      throw new CliError('ATM_CLI_USAGE', 'integration hook supports only: pre-agent | pre-tool', { exitCode: 2 });
    }
    state.event = arg;
  }
  if (!state.event) {
    throw new CliError('ATM_CLI_USAGE', 'integration hook requires an event: pre-agent | pre-tool', { exitCode: 2 });
  }
  const stdinPayload = readOptionalStdinJson(skipStdin);
  const payloadEditor = readStringPath(stdinPayload, ['editor', 'editorId', 'source']);
  const payloadTargetRepo = readStringPath(stdinPayload, ['targetRepo', 'target_repo', 'repository', 'repoPath', 'repo_path']);
  return {
    cwd: path.resolve(state.cwd),
    event: state.event,
    editor: normalizeAdapterId(state.editor ?? payloadEditor ?? 'unknown'),
    prompt: state.prompt ?? readStringPath(stdinPayload, ['prompt', 'userPrompt', 'transcript']),
    toolName: state.toolName ?? readStringPath(stdinPayload, ['toolName', 'tool_name', 'name']),
    command: state.command ?? extractCommandFromPayload(stdinPayload),
    files: state.files,
    targetRepo: state.targetRepo ?? payloadTargetRepo,
    stdinPayload
  };
}

function createCopilotHookFiles() {
  const content = {
    schemaId: 'atm.copilotFrameworkDevelopmentHooks.v1',
    hookContractVersion,
    hookProvider,
    marker: hookMarker,
    frameworkDevelopmentWakeMode: 'auto',
    mandatoryForFrameworkRepo: true,
    hooks: [
      {
        event: 'sessionStart',
        command: 'node atm.mjs integration hook pre-agent --editor copilot --json',
        blocking: false
      },
      {
        event: 'userPromptSubmitted',
        command: 'node atm.mjs integration hook pre-agent --editor copilot --json',
        blocking: false
      },
      {
        event: 'preToolUse',
        command: 'node atm.mjs integration hook pre-tool --editor copilot --json',
        blocking: true
      }
    ]
  };
  return [{
    path: '.github/hooks/atm-framework-development.json',
    content: `${JSON.stringify(content, null, 2)}\n`
  }];
}

function createClaudeHookFiles(root: string) {
  const settingsPath = path.join(root, '.claude', 'settings.json');
  const currentSettings = readJsonIfExists(settingsPath) ?? {};
  const settings = currentSettings as Record<string, unknown>;
  const hooks = typeof settings.hooks === 'object' && settings.hooks !== null && !Array.isArray(settings.hooks)
    ? settings.hooks as Record<string, unknown>
    : {};
  settings.hooks = {
    ...hooks,
    UserPromptSubmit: mergeClaudeHookEntries(hooks.UserPromptSubmit, 'node atm.mjs integration hook pre-agent --editor claude-code --json'),
    PreToolUse: mergeClaudeHookEntries(hooks.PreToolUse, 'node atm.mjs integration hook pre-tool --editor claude-code --json'),
    Stop: mergeClaudeHookEntries(hooks.Stop, 'node atm.mjs tasks audit --json')
  };
  settings.atmIntegrationHooks = {
    hookContractVersion,
    hookProvider,
    marker: hookMarker,
    frameworkDevelopmentWakeMode: 'auto',
    mandatoryForFrameworkRepo: true
  };
  return [{
    path: '.claude/settings.json',
    content: `${JSON.stringify(settings, null, 2)}\n`
  }];
}

function mergeClaudeHookEntries(existing: unknown, command: string) {
  const existingEntries = Array.isArray(existing) ? existing : [];
  const alreadyPresent = JSON.stringify(existingEntries).includes(command);
  if (alreadyPresent) return existingEntries;
  return [
    ...existingEntries,
    {
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command
        }
      ]
    }
  ];
}

function patchIntegrationManifestWithHookContract(root: string, adapterId: string, installedHookFiles: readonly string[]) {
  const manifestPath = path.join(root, '.atm', 'integrations', `${adapterId}.manifest.json`);
  if (!existsSync(manifestPath)) return;
  const manifest = readJsonIfExists(manifestPath);
  if (!manifest) return;
  const updatedManifest = {
    ...manifest,
    hookContractVersion,
    hookProvider,
    supportedHookEvents: adapterHookEvents[adapterId] ?? [],
    installedHookFiles,
    frameworkDevelopmentWakeMode: 'auto',
    mandatoryForFrameworkRepo: true
  };
  writeFileSync(manifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`, 'utf8');
}

function inspectEditorHookFile(root: string, relativePath: string, adapterId: string) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    return {
      path: relativePath,
      present: false,
      markerPresent: false,
      sha256: null
    };
  }
  const text = readFileSync(absolutePath, 'utf8');
  const expectedCommand = adapterId === 'copilot'
    ? 'node atm.mjs integration hook pre-tool --editor copilot --json'
    : 'node atm.mjs integration hook pre-tool --editor claude-code --json';
  return {
    path: relativePath,
    present: true,
    markerPresent: text.includes(hookMarker) && text.includes(hookContractVersion) && text.includes(expectedCommand),
    sha256: `sha256:${createHash('sha256').update(text).digest('hex')}`
  };
}

function extractPromptSignals(prompt: string): readonly string[] {
  const signals: string[] = [];
  const lowered = prompt.toLowerCase();
  if (/\batm\b|ai-atomic-framework|atomic framework/.test(lowered)) signals.push('prompt:atm-framework');
  if (/\bpackages\/|packages\\|packages\/core|packages\/cli/.test(lowered)) signals.push('prompt:packages');
  if (/\bframework-development\b|框架開發|治理/.test(lowered)) signals.push('prompt:framework-development');
  if (/\bhook\b|pre-commit|pre-tool|pre-agent/.test(lowered)) signals.push('prompt:hooks');
  if (/\b(?:TASK|ATM)-[A-Z0-9][A-Z0-9-]*-\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*\b/i.test(prompt)) signals.push('prompt:task-id');
  if (/任務卡|task\s*card|計畫書/i.test(prompt)) signals.push('prompt:task-scope');
  return uniqueSorted(signals);
}

function extractFilesFromPayload(value: unknown): readonly string[] {
  const files: string[] = [];
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object') return;
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry);
      return;
    }
    const record = candidate as Record<string, unknown>;
    for (const key of ['file_path', 'filePath', 'path', 'target_file', 'targetFile']) {
      if (typeof record[key] === 'string') files.push(normalizeRelativePath(record[key]));
    }
    for (const key of ['files', 'paths']) {
      if (Array.isArray(record[key])) {
        for (const entry of record[key]) {
          if (typeof entry === 'string') files.push(normalizeRelativePath(entry));
          else visit(entry);
        }
      }
    }
    for (const key of ['tool_input', 'toolInput', 'input', 'arguments', 'edits']) visit(record[key]);
  };
  visit(value);
  return uniqueSorted(files.filter(Boolean));
}

function extractCommandFromPayload(value: unknown): string | null {
  return readStringPath(value, ['command', 'cmd', 'script', 'bash', 'shell_command'])
    ?? readStringPath(value, ['tool_input.command', 'toolInput.command', 'input.command', 'arguments.command']);
}

function extractFilesFromCommand(command: string): readonly string[] {
  const matches = command.match(/[A-Za-z0-9_.@:/\\-]+\.(?:ts|tsx|js|mjs|json|md|yml|yaml|sh|ps1)/g) ?? [];
  return uniqueSorted(matches.map(normalizeRelativePath));
}

function frameworkDevelopmentInstructions() {
  return [
    'Run node atm.mjs next --prompt "<current user prompt>" --json, then run the returned claim command before changing framework critical files.',
    'Do not hand-edit task status to done.',
    'Do not use static JSON reports as completion evidence without commandRuns/stdout hashes.',
    'Let node atm.mjs hook pre-commit --json and guard commit-range enforce the final gate.'
  ];
}

function quoteHookCliValue(value: string): string {
  const trimmed = value.length > 240 ? `${value.slice(0, 240)}...` : value;
  return `"${trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function shouldSkipHookStdin(argv: readonly string[]): boolean {
  if (argv.includes('--no-stdin')) return true;
  const envValue = process.env.ATM_HOOK_NO_STDIN;
  return envValue === '1' || envValue === 'true';
}

/** Read optional JSON from piped stdin; exported for regression tests. */
export function readOptionalStdinJson(skipStdin = false): unknown {
  if (skipStdin || shouldSkipHookStdin([])) return null;
  if (process.stdin.isTTY) return null;
  return readPipedStdinJsonSync();
}

function readPipedStdinJsonSync(): unknown {
  // Non-TTY stdin from editor hooks is a pipe. Poll briefly, then read without blocking
  // forever on inherited idle pipes (common for npm/in-process validators).
  if (hasNonBlockingStdinSupport()) {
    return readPipedStdinJsonSyncNonBlocking();
  }
  return readPipedStdinJsonSyncWithTimedFallback();
}

function readPipedStdinJsonSyncNonBlocking(): unknown {
  const scratch = Buffer.alloc(HOOK_STDIN_CHUNK_BYTES);
  const chunks: Buffer[] = [];
  const deadline = Date.now() + HOOK_STDIN_POLL_MS;
  try {
    setStdinBlocking(false);
    while (Date.now() < deadline) {
      let bytesRead = 0;
      try {
        bytesRead = readStdinBytes(scratch);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EAGAIN' || code === 'EWOULDBLOCK') {
          Atomics.wait(hookStdinSleepBuffer, 0, 0, 1);
          continue;
        }
        return null;
      }
      if (bytesRead > 0) {
        chunks.push(Buffer.from(scratch.subarray(0, bytesRead)));
        drainAvailableStdin(scratch, chunks);
        break;
      }
      Atomics.wait(hookStdinSleepBuffer, 0, 0, 1);
    }
    return parseStdinJsonFromText(chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : '');
  } catch {
    return null;
  } finally {
    try {
      setStdinBlocking(true);
    } catch {
      // Ignore restore failures on platforms without setBlocking support.
    }
  }
}

function readPipedStdinJsonSyncWithTimedFallback(): unknown {
  const deadline = Date.now() + HOOK_STDIN_POLL_MS;
  while (Date.now() < deadline) {
    if ((process.stdin.readableLength ?? 0) > 0) break;
    if (process.stdin.readableEnded) break;
    Atomics.wait(hookStdinSleepBuffer, 0, 0, 1);
  }

  if ((process.stdin.readableLength ?? 0) > 0) {
    return parseStdinJsonFromRead(() => readFileSync(0, 'utf8'));
  }

  const fromChild = readStdinViaTimedChild(HOOK_STDIN_POLL_MS);
  if (fromChild !== null) {
    return parseStdinJsonFromText(fromChild);
  }

  if (process.stdin.readableEnded) {
    return parseStdinJsonFromRead(() => readFileSync(0, 'utf8'));
  }

  return null;
}

function readStdinViaTimedChild(timeoutMs: number): string | null {
  const result = spawnSync(
    process.execPath,
    ['--strip-types', '-e', 'import { readFileSync } from "node:fs"; process.stdout.write(readFileSync(0, "utf8"));'],
    {
      stdio: ['inherit', 'pipe', 'pipe'],
      timeout: timeoutMs,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: HOOK_STDIN_CHUNK_BYTES
    }
  );
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT') return null;
  }
  if (result.status !== 0) return null;
  const text = (result.stdout ?? '').trim();
  return text.length > 0 ? text : null;
}

function drainAvailableStdin(scratch: Buffer, chunks: Buffer[]): void {
  while (true) {
    try {
      const bytesRead = readStdinBytes(scratch);
      if (bytesRead > 0) {
        chunks.push(Buffer.from(scratch.subarray(0, bytesRead)));
        continue;
      }
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EAGAIN' || code === 'EWOULDBLOCK') break;
      return;
    }
  }
}

function parseStdinJsonFromRead(readText: () => string): unknown {
  try {
    return parseStdinJsonFromText(readText());
  } catch {
    return null;
  }
}

function parseStdinJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function stringifyPayload(value: unknown): string {
  return value ? JSON.stringify(value) : '';
}

function readStringPath(value: unknown, keys: readonly string[]): string | null {
  for (const key of keys) {
    const parts = key.split('.');
    let current: unknown = value;
    for (const part of parts) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        current = null;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    if (typeof current === 'string' && current.trim().length > 0) return current.trim();
  }
  return null;
}

function readIntegrationManifestIfExists(root: string, adapterId: string): (InstallManifest & Record<string, unknown>) | null {
  return readJsonIfExists(path.join(root, '.atm', 'integrations', `${adapterId}.manifest.json`)) as (InstallManifest & Record<string, unknown>) | null;
}

function readJsonIfExists(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeAdapterId(value: string): HookIntegrationId {
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (normalized.includes('copilot')) return 'copilot';
  if (normalized.includes('claude')) return 'claude-code';
  if (normalized.includes('cursor')) return 'cursor';
  if (normalized.includes('gemini')) return 'gemini';
  if (normalized.includes('codex')) return 'codex';
  if (normalized.includes('antigravity')) return 'antigravity';
  return normalized as HookIntegrationId;
}

function normalizeRelativePath(value: unknown): string {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function normalizePathForFrameworkRoot(value: string, frameworkRoot: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const normalizedRoot = path.resolve(frameworkRoot).replace(/\\/g, '/').toLowerCase();
  if (path.isAbsolute(raw)) {
    const normalizedAbsolute = path.resolve(raw).replace(/\\/g, '/');
    if (normalizedAbsolute.toLowerCase().startsWith(`${normalizedRoot}/`)) {
      return normalizedAbsolute.slice(normalizedRoot.length + 1);
    }
  }
  const normalized = normalizeRelativePath(raw);
  const lowered = normalized.toLowerCase();
  if (lowered.startsWith(`${normalizedRoot}/`)) {
    return normalized.slice(normalizedRoot.length + 1);
  }
  return normalized;
}

function normalizePathForRepoRoot(value: string, repoRoot: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (path.isAbsolute(raw)) {
    const normalizedAbsolute = path.resolve(raw);
    const relative = path.relative(path.resolve(repoRoot), normalizedAbsolute);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return normalizeRelativePath(relative);
    }
  }
  return normalizeRelativePath(raw);
}

function isPlanningClosureSurface(value: string): boolean {
  const normalized = normalizeRelativePath(value).toLowerCase();
  return normalized.endsWith('.task.md')
    || normalized.startsWith('.atm/history/tasks/')
    || normalized.startsWith('.atm/history/task-events/')
    || normalized.startsWith('.atm/history/evidence/')
    || normalized.startsWith('atomic_workbench/evidence/')
    || normalized.startsWith('atomic_workbench/reports/');
}

function isProtectedAtmManagedStatePath(value: string): boolean {
  const normalized = normalizeRelativePath(value).toLowerCase();
  return normalized.startsWith('.atm/history/tasks/')
    || normalized.startsWith('.atm/history/task-events/')
    || normalized.startsWith('.atm/history/evidence/')
    || normalized.startsWith('.atm/runtime/locks/')
    || normalized.startsWith('.atm/runtime/task-direction-locks/')
    || normalized.startsWith('.atm/runtime/batch-runs/')
    || normalized.startsWith('.atm/runtime/task-queues/')
    || normalized === '.atm/runtime/current-task.json'
    || normalized === '.atm/runtime/guidance/active-session.json';
}

function isRuntimeLockStatePath(value: string): boolean {
  return normalizeRelativePath(value).toLowerCase().startsWith('.atm/runtime/locks/');
}

function isStaticEvidenceArtifactPath(value: string): boolean {
  const normalized = normalizeRelativePath(value).toLowerCase();
  if (normalized.startsWith('atomic_workbench/evidence/') && normalized.endsWith('.json')) {
    return true;
  }
  if (normalized.startsWith('atomic_workbench/reports/') && normalized.endsWith('.json')) {
    return true;
  }
  return false;
}

function isAuthorizedAtmStateMutationCommand(command: string | null): boolean {
  const normalized = String(command ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return /\batm\.mjs\b/.test(normalized);
}

function isAuthorizedRuntimeLockMutationCommand(command: string | null): boolean {
  const normalized = String(command ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return /\batm\.mjs\b/.test(normalized);
}

function isAuthorizedStaticEvidenceArtifactCommand(command: string | null): boolean {
  const normalized = String(command ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return /\batm\.mjs\b/.test(normalized)
    || /\bnpm\s+run\s+validate:/i.test(normalized)
    || /\bnode\s+--strip-types\s+scripts\/validate-/i.test(normalized)
    || /\bnode\s+scripts\//i.test(normalized);
}

function isMutatingToolIntent(toolName: string | null, command: string | null): boolean {
  const normalizedToolName = String(toolName ?? '').trim().toLowerCase();
  if (/^(read|grep|glob|ls|list|search|view|open)$/i.test(normalizedToolName)) return false;
  if (/^(edit|write|multiedit|notebookedit|bash|shell|terminal|powershell)$/i.test(normalizedToolName)) return true;
  if (command) {
    const normalizedCommand = command.trim().toLowerCase();
    if (/^(git\s+status|git\s+log|git\s+show|rg\b|dir\b|ls\b|get-content\b|type\b|cat\b)/.test(normalizedCommand)) return false;
    if (/\b(git\s+add|git\s+commit|set-content|add-content|out-file|new-item|move-item|copy-item|remove-item|apply_patch)\b/.test(normalizedCommand)) return true;
  }
  return true;
}

function buildPromptScopedAllowedPaths(tasks: readonly {
  readonly taskPath: string;
  readonly sourcePlanPath: string | null;
  readonly nearbyPlanPaths: readonly string[];
  readonly scopePaths: readonly string[];
  readonly targetAllowedFiles?: readonly string[];
}[]): readonly string[] {
  const paths: string[] = [];
  for (const task of tasks) {
    const targetAllowedFiles = task.targetAllowedFiles ?? [];
    for (const entry of targetAllowedFiles.length > 0 ? targetAllowedFiles : task.scopePaths) {
      const normalized = normalizeRelativePath(entry);
      if (isTaskDirectionPathCandidate(normalized)) paths.push(normalized);
    }
  }
  return uniqueSorted(paths);
}

function buildPromptScopedPlanningMirrorPaths(tasks: readonly {
  readonly planningMirrorPaths?: readonly string[];
}[]): readonly string[] {
  return uniqueSorted(tasks.flatMap((task) => task.planningMirrorPaths ?? []));
}

function isPromptScopeDriftExempt(value: string): boolean {
  const normalized = normalizeRelativePath(value).toLowerCase();
  return normalized.startsWith('.atm/history/task-events/')
    || normalized.startsWith('.atm/history/evidence/')
    || normalized.startsWith('.atm/runtime/locks/')
    || normalized === '.atm/history/tasks'
    || normalized === '.atm/history/evidence'
    || normalized === '.atm/history/task-events';
}

function isToolFileInPromptScope(filePath: string, scopePaths: readonly string[]): boolean {
  const normalizedFile = normalizeRelativePath(filePath).toLowerCase();
  return scopePaths.some((candidate) => matchesPromptScopePath(normalizedFile, candidate.toLowerCase()));
}

function matchesPromptScopePath(filePath: string, scopePath: string): boolean {
  if (!scopePath) return false;
  if (scopePath.includes('*')) {
    const pattern = scopePath
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '::DOUBLE_STAR::')
      .replace(/\*/g, '[^/]*')
      .replace(/::DOUBLE_STAR::/g, '.*');
    return new RegExp(`^${pattern}$`, 'i').test(filePath);
  }
  if (filePath === scopePath) return true;
  if (scopePath.endsWith('/')) return filePath.startsWith(scopePath);
  const scopeHasExtension = /\.[a-z0-9]+$/i.test(scopePath);
  if (!scopeHasExtension) return filePath.startsWith(`${scopePath}/`);
  return false;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(normalizeRelativePath).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function requireValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `integration hook command requires a value for ${flag}`, { exitCode: 2 });
  }
  return value;
}
