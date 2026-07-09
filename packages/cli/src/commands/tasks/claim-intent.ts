import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { relativePathFrom } from '../shared.ts';
import { sanitizeTaskDirectionAllowedFiles } from '../task-direction.ts';
import { extractTaskCloseDeclaredFiles } from './close-helpers/close-artifact-staging.ts';
import { pathMatchesTaskScope } from './historical-delivery.ts';
import { normalizeRelativePath } from './task-file-io-helpers.ts';

export interface TaskClaimIntentResolution {
  readonly requestedClaimIntent: 'write' | 'closeout-only';
  readonly resolvedClaimIntent: 'write' | 'closeout-only';
  readonly autoIntent: boolean;
  readonly explicitClaimIntent: boolean;
  readonly reason: string;
  readonly dirtyInScopeFiles: readonly string[];
  readonly declaredDeliverableFiles: readonly string[];
  readonly deliverablesTrackedInHead: readonly string[];
  readonly missingDeliverables: readonly string[];
}

export function resolveTaskClaimIntent(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly taskDocument: Record<string, unknown>;
  readonly requestedClaimIntent: 'write' | 'closeout-only';
  readonly autoIntent: boolean;
  readonly explicitClaimIntent: boolean;
}): TaskClaimIntentResolution {
  const declaredFiles = normalizeTaskScopePaths(input.cwd, extractTaskCloseDeclaredFiles(input.taskDocument, input.cwd, input.taskId));
  const source = input.taskDocument.source && typeof input.taskDocument.source === 'object' && !Array.isArray(input.taskDocument.source)
    ? input.taskDocument.source as Record<string, unknown>
    : {};
  const planPath = typeof source.planPath === 'string' ? normalizeRelativePath(source.planPath) : '';
  const inScopeSourceFiles = declaredFiles.filter((filePath) => !filePath.startsWith('.atm/') && filePath !== planPath);
  const dirtyFiles = uniqueStrings([
    ...readGitNameOnly(input.cwd, ['diff', '--name-only', '--cached']),
    ...readGitNameOnly(input.cwd, ['diff', '--name-only']),
    ...readGitNameOnly(input.cwd, ['ls-files', '-o', '--exclude-standard'])
  ]).filter((filePath) => inScopeSourceFiles.some((declared) => pathMatchesTaskScope(filePath, declared)));
  const declaredDeliverableFiles = extractStringList(input.taskDocument.deliverables)
    .map(normalizeRelativePath)
    .filter((filePath) => Boolean(filePath) && !filePath.startsWith('.atm/'));
  const deliverablesTrackedInHead = declaredDeliverableFiles.filter((filePath) => isTaskClaimDeliverableTrackedInHead(input.cwd, filePath));
  const missingDeliverables = declaredDeliverableFiles.filter((filePath) => !deliverablesTrackedInHead.includes(filePath));
  if (!input.autoIntent) {
    return {
      requestedClaimIntent: input.requestedClaimIntent,
      resolvedClaimIntent: input.requestedClaimIntent,
      autoIntent: false,
      explicitClaimIntent: input.explicitClaimIntent,
      reason: input.explicitClaimIntent ? 'explicit-claim-intent' : 'default-write-claim-intent',
      dirtyInScopeFiles: dirtyFiles,
      declaredDeliverableFiles,
      deliverablesTrackedInHead,
      missingDeliverables
    };
  }
  const resolvedClaimIntent = dirtyFiles.length > 0
    ? 'write'
    : declaredDeliverableFiles.length > 0 && missingDeliverables.length === 0
      ? 'closeout-only'
      : 'write';
  return {
    requestedClaimIntent: input.requestedClaimIntent,
    resolvedClaimIntent,
    autoIntent: true,
    explicitClaimIntent: false,
    reason: dirtyFiles.length > 0
      ? deliverablesTrackedInHead.length > 0
        ? 'dirty-in-scope-source-overrides-closeout'
        : 'dirty-in-scope-source'
      : declaredDeliverableFiles.length > 0 && missingDeliverables.length === 0
        ? 'deliverables-already-in-head'
        : 'deliverables-not-yet-landed',
    dirtyInScopeFiles: dirtyFiles,
    declaredDeliverableFiles,
    deliverablesTrackedInHead,
    missingDeliverables
  };
}

function isTaskClaimDeliverableTrackedInHead(cwd: string, filePath: string): boolean {
  if (!filePath || /[*?[\]{}]/.test(filePath)) return false;
  try {
    execFileSync('git', ['-C', cwd, 'cat-file', '-e', `HEAD:${filePath}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function readGitNameOnly(cwd: string, args: readonly string[]): readonly string[] {
  try {
    const output = execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return uniqueStrings(output.split(/\r?\n/).map(normalizeRelativePath).filter(Boolean));
  } catch {
    return [];
  }
}
