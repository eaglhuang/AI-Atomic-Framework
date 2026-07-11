// TASK-RFT-0013 — extracted verbatim from packages/cli/src/commands/tasks.ts.
// Close-artifact staging cluster: extract declared/deliverable files, evaluate
// the task deliverable gate, stage close artifacts through git, and expose the
// canonical delivery-principle text.

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relativePathFrom } from '../../shared.ts';
import type { TaskClaimRecord } from '@ai-atomic-framework/core';
import type { TaskDeliverableGateReport } from '../result-contracts.ts';
import { normalizeRelativePath } from '../task-file-io-helpers.ts';
import { pathMatchesTaskScope, isDeliverableGateCandidate, inspectHistoricalDelivery } from '../historical-delivery.ts';
import { sanitizeTaskDirectionAllowedFiles } from '../../task-direction.ts';
import { isTaskCloseGovernanceCriticalPath } from '../../framework-development/critical-path-gate.ts';
import { listCommittedFilesSinceClaim as delegatedListCommittedFilesSinceClaim } from '../task-git-helpers.ts';

function uniqueStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function extractStringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean)
    : [];
}

function normalizeTaskScopePaths(cwd: string, values: readonly string[]): readonly string[] {
  return sanitizeTaskDirectionAllowedFiles(values.map((entry) => {
    const normalized = normalizeRelativePath(entry);
    if (!normalized) return '';
    return path.isAbsolute(normalized)
      ? normalizeRelativePath(relativePathFrom(cwd, normalized))
      : normalized;
  }));
}

function readRuntimeTaskDirectionLock(cwd: string, taskId: string): Record<string, unknown> {
  const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
  if (!existsSync(lockPath)) return {};
  try {
    const outerLock = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
    const embeddedLock = outerLock.taskDirectionLock;
    return embeddedLock && typeof embeddedLock === 'object' && !Array.isArray(embeddedLock)
      ? embeddedLock as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function extractTaskCloseClaimScopeFiles(taskDocument: Record<string, unknown>, cwd?: string, taskId?: string): readonly string[] {
  const taskDirectionLock = taskDocument.taskDirectionLock && typeof taskDocument.taskDirectionLock === 'object' && !Array.isArray(taskDocument.taskDirectionLock)
    ? taskDocument.taskDirectionLock as Record<string, unknown>
    : {};
  const claim = taskDocument.claim && typeof taskDocument.claim === 'object' && !Array.isArray(taskDocument.claim)
    ? taskDocument.claim as Record<string, unknown>
    : {};
  const runtimeLock = cwd && taskId ? readRuntimeTaskDirectionLock(cwd, taskId) : {};
  return uniqueStrings([
    ...extractStringList(taskDirectionLock.allowedFiles),
    ...extractStringList(runtimeLock.allowedFiles),
    ...extractStringList(claim.files)
  ]);
}

// Re-declared here (imported from task-import-validators would create surface churn).
function extractTaskDeclaredFilesLocal(taskDocument: Record<string, unknown>): string[] {
  const scope = Array.isArray(taskDocument.scopePaths) ? taskDocument.scopePaths : [];
  const deliverables = Array.isArray(taskDocument.deliverables) ? taskDocument.deliverables : [];
  const claim = taskDocument.claim && typeof taskDocument.claim === 'object' && !Array.isArray(taskDocument.claim)
    ? (taskDocument.claim as Record<string, unknown>).files
    : undefined;
  const claimFiles = Array.isArray(claim) ? claim : [];
  const values = [...scope, ...deliverables, ...claimFiles]
    .map((entry) => typeof entry === 'string' ? entry.trim() : '')
    .filter(Boolean);
  return [...new Set(values)];
}

export function extractTaskCloseDeclaredFiles(
  taskDocument: Record<string, unknown>,
  cwd?: string,
  taskId?: string,
  options: { checkpointScoped?: boolean } = {}
): readonly string[] {
  const claimScopedFiles = extractTaskCloseClaimScopeFiles(taskDocument, cwd, taskId);
  if (options.checkpointScoped) {
    return claimScopedFiles;
  }
  return uniqueStrings([
    ...claimScopedFiles,
    ...extractStringList(taskDocument.targetAllowedFiles),
    ...extractTaskDeclaredFilesLocal(taskDocument)
  ]);
}

export function extractTaskDeliverableFiles(taskDocument: Record<string, unknown>): readonly string[] {
  return extractStringList(taskDocument.deliverables);
}

export function taskDeliveryPrincipleText() {
  return 'The goal is to deliver the requested task content, not to close task cards. done is only the record after real deliverables and validators exist.';
}

function isDeliverableDiffRequired(taskDocument: Record<string, unknown>): boolean {
  const mode = String(taskDocument.deliverableMode ?? taskDocument.deliverable_mode ?? '').toLowerCase();
  if (mode === 'ledger-only') return false;
  const source = taskDocument.source && typeof taskDocument.source === 'object' && !Array.isArray(taskDocument.source)
    ? taskDocument.source as Record<string, unknown>
    : {};
  const importedFromPlan = typeof source.planPath === 'string' && source.planPath.trim().length > 0;
  if (importedFromPlan) return true;
  const haystack = [
    taskDocument.title,
    taskDocument.type,
    taskDocument.kind,
    taskDocument.category,
    ...(Array.isArray(taskDocument.tags) ? taskDocument.tags : []),
    ...(Array.isArray(taskDocument.deliverables) ? taskDocument.deliverables : []),
    ...(Array.isArray(taskDocument.acceptance) ? taskDocument.acceptance : [])
  ].filter((entry): entry is string => typeof entry === 'string').join('\n').toLowerCase();
  return /\b(code|pipeline|data|runner|script|report|artifact|manifest|bundle|adapter|checker|builder|job|jsonl|python|typescript|reviewer)\b/.test(haystack)
    || /資料|管線|腳本|執行器|報告|產物|審核表|清單|候選|白名單|黑名單|人物|關係/.test(haystack);
}

function listChangedFilesForDeliverableGate(cwd: string, claim: TaskClaimRecord | null, taskId: string | null = null): { readonly files: readonly string[]; readonly gitAvailable: boolean } {
  const files = new Set<string>();
  let gitAvailable = false;

  let allowedSet: Set<string> | null = null;
  if (taskId) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (existsSync(taskPath)) {
      try {
        const taskDoc = JSON.parse(readFileSync(taskPath, 'utf8'));
        const allowedFiles = extractTaskCloseDeclaredFiles(taskDoc as Record<string, unknown>);
        if (allowedFiles.length > 0) {
          allowedSet = new Set(normalizeTaskScopePaths(cwd, allowedFiles));
        }
      } catch {
        // Ignore read/parse errors
      }
    }
  }

  for (const args of [
    ['-C', cwd, 'diff', '--name-only', '--cached'],
    ['-C', cwd, 'diff', '--name-only'],
    ['-C', cwd, 'ls-files', '-o', '--exclude-standard']
  ]) {
    try {
      const output = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      gitAvailable = true;
      const isUntrackedCmd = args.includes('ls-files');
      for (const line of output.split(/\r?\n/)) {
        const normalized = normalizeRelativePath(line);
        if (normalized) {
          if (isUntrackedCmd && allowedSet) {
            const isDeliverable = allowedSet.has(normalized)
              || isTaskCloseGovernanceCriticalPath(normalized, taskId || '');
            if (!isDeliverable) {
              continue;
            }
          }
          files.add(normalized);
        }
      }
    } catch {
      // Sandboxed or non-git hosts use a declared-file existence fallback.
    }
  }
  const committedSinceClaim = delegatedListCommittedFilesSinceClaim(cwd, claim);
  if (committedSinceClaim.gitAvailable) gitAvailable = true;
  for (const filePath of committedSinceClaim.files) {
    files.add(filePath);
  }
  return { files: [...files].sort((left, right) => left.localeCompare(right)), gitAvailable };
}

export function evaluateTaskDeliverableGate(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly taskDocument: Record<string, unknown>;
  readonly taskDeclaredFiles: readonly string[];
  readonly claim: TaskClaimRecord | null;
  readonly historicalDeliveryRefs?: readonly string[];
  readonly historicalDeliveryRepo?: string | null;
  readonly waiverOutOfScopeDelivery?: boolean;
  readonly waiverReason?: string | null;
}): TaskDeliverableGateReport {
  const required = isDeliverableDiffRequired(input.taskDocument);
  const declaredFiles = normalizeTaskScopePaths(input.cwd, input.taskDeclaredFiles);
  const changedFileReport = listChangedFilesForDeliverableGate(input.cwd, input.claim, input.taskId);
  const changedFiles = (changedFileReport.gitAvailable
    ? changedFileReport.files
    : uniqueStrings([
      ...changedFileReport.files,
      ...declaredFiles.filter((filePath) => existsSync(path.resolve(input.cwd, filePath)))
    ])
  );
  const deliverableFiles = changedFiles.filter((filePath) => isDeliverableGateCandidate(filePath, declaredFiles));
  const enforceDeclaredScope = declaredFiles.some((filePath) =>
    !filePath.startsWith('.atm/') && filePath !== normalizeRelativePath((input.taskDocument.source as { planPath?: string } | undefined)?.planPath ?? '')
  );
  const scopedDeliverables = enforceDeclaredScope
    ? deliverableFiles.filter((filePath) => declaredFiles.some((declared) => pathMatchesTaskScope(filePath, declared)))
    : deliverableFiles;
  const historicalDeliveries = (input.historicalDeliveryRefs ?? []).map((ref) => inspectHistoricalDelivery({
    cwd: input.historicalDeliveryRepo ?? input.cwd,
    taskId: input.taskId,
    requestedRef: ref,
    declaredFiles,
    enforceDeclaredScope,
    waiverOutOfScopeDelivery: input.waiverOutOfScopeDelivery === true,
    waiverReason: input.waiverReason ?? null
  }));
  const historicalDeliveryErrors = historicalDeliveries.filter((entry) => !entry.ok);
  const historicalDeliverableFiles = uniqueStrings(historicalDeliveries.flatMap((entry) => entry.deliverableFiles));
  const allDeliverableFiles = uniqueStrings([...scopedDeliverables, ...historicalDeliverableFiles]);
  const ok = !required || (allDeliverableFiles.length > 0 && historicalDeliveryErrors.length === 0);
  const reason = required
    ? ok
      ? scopedDeliverables.length > 0
        ? 'real-deliverable-diff-present'
        : 'historical-delivery-diff-present'
      : historicalDeliveryErrors.length > 0
        ? 'historical-delivery-invalid'
        : 'missing-real-deliverable-diff'
    : 'task-does-not-require-real-deliverable-diff';
  return {
    schemaId: 'atm.taskDeliverableGate.v1',
    generatedAt: new Date().toISOString(),
    taskId: input.taskId,
    deliveryPrinciple: taskDeliveryPrincipleText(),
    required,
    ok,
    reason,
    changedFiles,
    deliverableFiles: allDeliverableFiles,
    declaredFiles,
    historicalDeliveries,
    notAllowedAsCompletion: [
      'only changing .atm/history task JSON, evidence JSON, task-events, runtime locks, or queue state',
      'text-only evidence without a real deliverable file diff',
      'replaying old close commits or cherry-picking prior ledger-only closure without a scoped delivery commit',
      'closing a batch queue item before implementing the current task deliverables'
    ],
    remediation: ok
      ? 'Deliverable diff found; continue with validators and closure evidence.'
      : 'Implement the deliverables described by the task, stage or leave the real file changes visible, then rerun tasks close --status done. If the deliverable already landed in an earlier commit, pass --historical-delivery <commit> so ATM can verify the scoped non-.atm files. If the historical commit also contains unrelated source files, pass --waiver-out-of-scope-delivery with --reason. If the task is not delivered yet, close review instead of done.',
    requiredCommand: ok ? null : `node atm.mjs tasks close --task ${input.taskId} --actor <actor> --status review --reason "awaiting real deliverable diff" --json`
  };
}

export function stageTaskCloseArtifacts(cwd: string, files: readonly (string | null | undefined)[]) {
  const normalizedFiles = uniqueStrings(files.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean));
  if (normalizedFiles.length === 0) return;
  execFileSync('git', ['add', '--', ...normalizedFiles], {
    cwd,
    stdio: ['ignore', 'ignore', 'pipe']
  });
}

export function existingTaskCloseArtifacts(cwd: string, files: readonly (string | null | undefined)[]) {
  return uniqueStrings(files
    .map((entry) => typeof entry === 'string' ? entry.trim() : '')
    .filter((entry) => entry && existsSync(path.resolve(cwd, entry))));
}
