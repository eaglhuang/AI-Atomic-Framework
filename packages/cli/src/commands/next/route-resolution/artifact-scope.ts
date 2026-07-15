// @ts-nocheck
import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  compareScoredTasks,
  looksLikeTaskArtifact,
  isLikelyPromptPathHint,
  pathFieldMatches,
  looksLikeNamedPlanPrompt,
  allowsPlanningMirror,
  statusQueueWeight,
  tokenizeForMatch,
  countTokenOverlap
} from '../match-and-sort.ts';
import { buildPromptScopedQueueClaimCommand } from '../prompt-scope-resolution.ts';
import { readConfiguredPlanningRoots } from '../../planning-repo-root.ts';
import { resolveCandidatePlanningRoots } from '../planning-root-preference.ts';
import { bootstrapTaskId } from '../../governance-runtime.ts';
import { CliError, parseJsonText, quoteCliValue } from '../../shared.ts';
import {
  abandonTaskQueue,
  buildAllowedFilesForTask,
  createOrRefreshTaskQueue,
  findActiveTaskQueue,
  isTaskDirectionPathCandidate,
  partitionTaskScope,
  readActiveTaskDirectionLocks,
  type TaskQueueRecord
} from '../../task-direction.ts';
import {
  extractPathLikeStringsFromPrompt,
  isPathAllowedByScope,
  listActiveBatchRuns,
  readActiveBatchRun,
  repairBatchRunFromQueue
} from '../../work-channels.ts';
import {
  parseMarkdownFrontmatter,
  normalizeTaskRouteStatus,
  normalizeOptionalBoolean,
  normalizeSearchText,
  normalizeTaskIntent,
  normalizeOptionalTaskPath,
  readStringArray,
  splitListValue,
  type RequestedTaskAction,
  type TaskIntent,
  type TaskIntentSource
} from '../intent-normalizers.ts';
import {
  areTaskDependenciesSatisfied,
  canTaskBePreparedForClaim,
  hasRequiredPromptScopeMatch,
  isClosedTaskStatus,
  isExplicitSingleTaskRoute,
  isQueueRequestedPrompt,
  isTaskCardSurfaceOnlyMatch,
  isTaskAlreadyActivelyClaimed,
  isTaskExplicitlyMentioned,
  isTaskRoutable,
  shouldDiscoverMarkdownTaskCards,
  type ImportedTaskQueue,
  type ImportedTaskSummary,
  type PromptScopedRouteStatus,
  type PromptScopedTaskRoute
} from '../route-predicates.ts';
import {
  sha256,
  uniqueInOrder,
  uniqueSorted
} from '../view-projections.ts';
import { shouldReportPlanningRootMissing } from '../../planning-repo-root.ts';
import { normalizeOptionalString } from './intent.ts';

export interface ImportedTaskSummaryWithOutOfScope extends ImportedTaskSummary {
  readonly outOfScope?: readonly string[];
}

export function finalizeImportedTaskSummary(task: Omit<ImportedTaskSummary, 'planningReadOnlyPaths' | 'planningMirrorPaths' | 'targetAllowedFiles'> & { readonly outOfScope?: readonly string[] }, cwd?: string): ImportedTaskSummaryWithOutOfScope {
  const partition = partitionTaskScope(task, cwd ? { cwd } : undefined);
  return {
    ...task,
    planningReadOnlyPaths: partition.planningContext.readOnlyPaths,
    planningMirrorPaths: partition.targetWork.planningMirrorPaths,
    targetAllowedFiles: partition.targetWork.allowedFiles
  };
}

export function withMirrorSyncOnlyTarget<T extends ImportedTaskSummary>(task: T): T {
  return {
    ...task,
    targetAllowedFiles: []
  };
}

export function withMirrorSyncOnlyTargetQueue(queue: ImportedTaskQueue, taskId: string): ImportedTaskQueue {
  const rewrite = (task: ImportedTaskSummary) => task.workItemId === taskId ? withMirrorSyncOnlyTarget(task) : task;
  return {
    ...queue,
    selectedTask: queue.selectedTask ? rewrite(queue.selectedTask) : queue.selectedTask,
    claimableTask: queue.claimableTask && queue.claimableTask.workItemId === taskId ? null : queue.claimableTask,
    tasks: queue.tasks.map(rewrite),
    promptScope: queue.promptScope
      ? {
        ...queue.promptScope,
        selectedTasks: queue.promptScope.selectedTasks.map(rewrite)
      }
      : queue.promptScope
  };
}

export function extractDeclaredTaskPathsFromDocument(taskDocument: Record<string, unknown>) {
  const files = new Set<string>();
  for (const key of ['scope', 'files', 'changedFiles', 'criticalChangedFiles', 'guardPaths', 'targetFiles', 'deliverables', 'artifacts']) {
    collectDeclaredTaskPathValues(taskDocument[key], files);
  }
  const source = taskDocument.source;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const sourceRecord = source as Record<string, unknown>;
    collectDeclaredTaskPathValues(sourceRecord.path, files);
    collectDeclaredTaskPathValues(sourceRecord.planPath, files);
  }
  for (const key of ['notes', 'summary', 'description', 'acceptance']) {
    collectDeclaredTaskPathValues(taskDocument[key], files);
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

export function extractLinkedSourceTaskArtifactPaths(cwd: string, sourcePlanPath: string | null) {
  if (!sourcePlanPath) return [];
  const absolutePlanPath = path.isAbsolute(sourcePlanPath) ? sourcePlanPath : path.resolve(cwd, sourcePlanPath);
  if (!existsSync(absolutePlanPath)) return [];
  try {
    return extractTaskArtifactPathsFromMarkdown(cwd, readFileSync(absolutePlanPath, 'utf8'));
  } catch {
    return [];
  }
}

function collectDeclaredTaskPathValues(value: unknown, files: Set<string>) {
  if (typeof value === 'string') {
    const normalized = normalizeOptionalTaskPath(value);
    if (normalized && isTaskDirectionPathCandidate(normalized)) {
      files.add(normalized);
    }
    for (const candidate of extractPathLikeStringsFromText(value)) {
      files.add(candidate);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectDeclaredTaskPathValues(entry, files);
    }
  }
}

export function extractTaskArtifactPathsFromMarkdown(cwd: string, text: string) {
  return uniqueSorted([
    ...extractPathLikeStringsFromText(text),
    ...resolveBareArtifactPathCandidates(cwd, extractBareArtifactFileNames(text)),
    ...extractCommandSurfacePathsFromMarkdown(text)
  ]);
}

function extractPathLikeStringsFromText(text: string) {
  const candidates = new Set<string>();
  const matches = text.matchAll(/\b(?:\.atm|docs|atomic_workbench|packages|scripts|schemas|specs|templates|integrations|examples|tests|release|\.github|\.claude|\.cursor|\.gemini)(?:\/[A-Za-z0-9._-]+)+\b|\b(?:atm\.mjs|package(?:-lock)?\.json|tsconfig(?:\.[A-Za-z0-9._-]+)?\.json)\b/g);
  for (const match of matches) {
    const normalized = normalizeOptionalTaskPath(match[0]);
    if (normalized) {
      candidates.add(normalized);
    }
  }
  return [...candidates].sort((left, right) => left.localeCompare(right));
}

function extractBareArtifactFileNames(text: string) {
  const candidates = new Set<string>();
  const matches = text.matchAll(/(?:^|[\s`"'([>-])([A-Za-z0-9][A-Za-z0-9._-]*\.(?:json|jsonl|md|csv|tsv|txt|ya?ml|html|xml))(?:$|[\s`"')\]<,.;:])/gmi);
  for (const match of matches) {
    const fileName = match[1]?.trim();
    if (!fileName || fileName.includes('/') || fileName.includes('\\')) continue;
    if (fileName.length > 120) continue;
    candidates.add(fileName);
  }
  return [...candidates].sort((left, right) => left.localeCompare(right));
}

function resolveBareArtifactPathCandidates(cwd: string, fileNames: readonly string[]) {
  if (fileNames.length === 0) return [];
  const output = new Set<string>();
  const knownArtifactFiles = listKnownArtifactFiles(cwd);
  const artifactFilesByBasename = new Map<string, string[]>();
  for (const artifactPath of knownArtifactFiles) {
    const key = path.basename(artifactPath).toLowerCase();
    const existing = artifactFilesByBasename.get(key) ?? [];
    existing.push(artifactPath);
    artifactFilesByBasename.set(key, existing);
  }

  for (const fileName of fileNames) {
    for (const candidateName of artifactFileNameVariants(fileName)) {
      for (const existingPath of artifactFilesByBasename.get(candidateName.toLowerCase()) ?? []) {
        output.add(existingPath);
      }
      const atomizationCoveragePath = resolveAtomizationCoverageArtifactPath(candidateName);
      if (atomizationCoveragePath) {
        output.add(atomizationCoveragePath);
      }
    }
  }
  return [...output].sort((left, right) => left.localeCompare(right));
}

function listKnownArtifactFiles(cwd: string) {
  const roots = [
    'atomic_workbench',
    'artifacts',
    'docs',
    'fixtures',
    'reports',
    'schemas'
  ];
  return uniqueSorted(roots.flatMap((root) => {
    const absoluteRoot = path.join(cwd, root);
    return listFilesRecursive(absoluteRoot, (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      return ['.json', '.jsonl', '.md', '.csv', '.tsv', '.txt', '.yaml', '.yml'].includes(ext);
    }).map((filePath) => path.relative(cwd, filePath).replace(/\\/g, '/'));
  }));
}

function artifactFileNameVariants(fileName: string) {
  const variants = new Set<string>();
  const normalized = fileName.trim();
  if (!normalized) return [];
  variants.add(normalized);
  if (normalized.startsWith('atm-')) {
    variants.add(normalized.slice('atm-'.length));
  }
  return [...variants].sort((left, right) => left.localeCompare(right));
}

function resolveAtomizationCoverageArtifactPath(fileName: string) {
  const basename = path.basename(fileName);
  const atomizationCoverageArtifacts = new Set([
    'dogfood-score.json',
    'dogfood-score.md',
    'exclusion-inventory.json',
    'generated-fixture-boundaries.json',
    'path-to-atom-map.json',
    'manifest.json'
  ]);
  if (!atomizationCoverageArtifacts.has(basename)) return null;
  if (basename === 'manifest.json') {
    return 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/manifest.json';
  }
  return `atomic_workbench/atomization-coverage/${basename}`;
}

function extractCommandSurfacePathsFromMarkdown(text: string) {
  const paths = new Set<string>();
  for (const match of text.matchAll(/\bnode\s+atm\.mjs\s+(guard|validate)\s+([a-z][a-z0-9-]*)\b/gi)) {
    const command = match[1]?.toLowerCase();
    const topic = match[2]?.toLowerCase();
    if (command === 'guard') {
      paths.add('packages/cli/src/commands/guard.ts');
    }
    if (command === 'validate') {
      paths.add('packages/cli/src/commands/validate.ts');
      addValidateTopicPaths(paths, topic);
    }
  }
  for (const match of text.matchAll(/\bnpm\s+run\s+validate:([a-z][a-z0-9-]*)\b/gi)) {
    addValidateTopicPaths(paths, match[1]?.toLowerCase());
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function addValidateTopicPaths(paths: Set<string>, topic: string | undefined) {
  if (!topic) return;
  paths.add('package.json');
  paths.add(`scripts/validate-${topic}.ts`);
}

export function resolveQuickfixScope(prompt: string) {
  return uniqueSorted([
    ...extractPathLikeStringsFromText(prompt),
    ...extractPathLikeStringsFromPrompt(prompt)
  ]);
}
