import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../shared.ts';
import { extractFrontMatter, normalizeTaskId } from '../tasks/task-import-validators.ts';
import type { TaskflowDelegationContract, TaskflowProfileV1 } from './profile-loader.ts';

export interface HostOpenerPolicyDecision {
  taskId: string;
  outputPath: string;
  sources: {
    taskId: 'explicit' | 'host-policy';
    outputPath: 'explicit' | 'host-policy';
  };
  diagnostics: string[];
  familyDrift: HostOpenerFamilyDrift | null;
}

export interface HostOpenerFamilyDrift {
  schemaId: 'atm.taskIdFamilyDrift.v1';
  status: 'clear' | 'duplicate-semantic-family';
  code: 'ATM_TASK_ID_FAMILY_DRIFT';
  requestedTaskId: string;
  requestedFamily: string;
  requestedSemanticKey: string;
  existingTaskId: string;
  existingFamily: string;
  existingPath: string;
  message: string;
}

export interface HostOpenerPolicyInput {
  cwd: string;
  profile: TaskflowProfileV1;
  delegationContract: TaskflowDelegationContract;
  taskId?: string | null;
  outputPath?: string | null;
  title?: string | null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseNumericSuffixFormat(format: string): { prefix: string; width: number } {
  const match = /^(.*?)(N+)$/.exec(format.trim());
  if (!match) {
    throw new CliError(
      'ATM_TASKFLOW_HOST_POLICY_AMBIGUOUS_NUMBERING',
      `Host opener numbering format "${format}" is ambiguous; expected a trailing N-run such as PREFIX-NNNN.`,
      { exitCode: 1 }
    );
  }
  return { prefix: match[1], width: match[2].length };
}

function formatTaskIdFromNumber(format: string, numericSuffix: number): string {
  const parsed = parseNumericSuffixFormat(format);
  const padded = String(numericSuffix).padStart(parsed.width, '0');
  return `${parsed.prefix}${padded}`;
}

function collectExistingNumericSuffixes(
  cwd: string,
  directory: string,
  format: string
): number[] {
  const parsed = parseNumericSuffixFormat(format);
  const absDir = path.resolve(cwd, directory);
  if (!existsSync(absDir)) {
    return [];
  }

  const suffixes = new Set<number>();
  const fileNamePattern = new RegExp(
    `^${escapeRegex(parsed.prefix)}(\\d{${parsed.width}})(?:\\.task\\.md)?$`,
    'i'
  );
  const idPattern = new RegExp(
    `^${escapeRegex(parsed.prefix)}(\\d{${parsed.width}})$`,
    'i'
  );

  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      const fileMatch = fileNamePattern.exec(entry.name);
      if (fileMatch) {
        suffixes.add(Number.parseInt(fileMatch[1], 10));
      }
      if (entry.name.endsWith('.task.md') || entry.name.endsWith('.md')) {
        try {
          const frontMatter = extractFrontMatter(readFileSync(path.join(absDir, entry.name), 'utf8'));
          const rawTaskId = typeof frontMatter?.data.task_id === 'string'
            ? frontMatter.data.task_id
            : typeof frontMatter?.data.id === 'string'
              ? frontMatter.data.id
              : null;
          if (rawTaskId) {
            const idMatch = idPattern.exec(normalizeTaskId(rawTaskId));
            if (idMatch) {
              suffixes.add(Number.parseInt(idMatch[1], 10));
            }
          }
        } catch {
          // ignore unreadable files during scan
        }
      }
      continue;
    }
    if (entry.isDirectory()) {
      const nestedMatch = fileNamePattern.exec(entry.name);
      if (nestedMatch) {
        suffixes.add(Number.parseInt(nestedMatch[1], 10));
      }
    }
  }

  return [...suffixes].sort((left, right) => left - right);
}

function allocateTaskIdFromPolicy(
  cwd: string,
  profile: TaskflowProfileV1,
  policy: TaskflowDelegationContract['policy']
): { taskId: string; diagnostics: string[] } {
  if (policy.allocateTaskId.mode !== 'host-opener') {
    throw new CliError(
      'ATM_TASKFLOW_HOST_POLICY_NUMBERING_UNSUPPORTED',
      'Host opener numbering is not configured; supply --task-id explicitly.',
      { exitCode: 1 }
    );
  }

  const format = policy.allocateTaskId.format ?? profile.taskId.format;
  const directory = policy.resolveCanonicalOutputPath.directory ?? '.';
  const existing = [...new Set([...collectExistingNumericSuffixes(cwd, directory, format), ...collectOriginTaskSuffixes(cwd, format, directory)])];
  const nextSuffix = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  const taskId = formatTaskIdFromNumber(format, nextSuffix);

  return {
    taskId,
    diagnostics: [
      `Allocated task id ${taskId} from host-neutral policy format ${format}.`,
      `Scanned directory ${directory} and found ${existing.length} existing id(s).`
    ]
  };
}

function resolveOutputPathFromPolicy(
  taskId: string,
  title: string | null,
  policy: TaskflowDelegationContract['policy']
): { outputPath: string; diagnostics: string[] } {
  if (policy.resolveCanonicalOutputPath.mode !== 'host-opener') {
    throw new CliError(
      'ATM_TASKFLOW_HOST_POLICY_PATH_UNSUPPORTED',
      'Host opener canonical output-path policy is not configured; supply --output explicitly.',
      { exitCode: 1 }
    );
  }

  const pattern = policy.resolveCanonicalOutputPath.pattern;
  if (!pattern || !pattern.includes('${taskId}')) {
    throw new CliError(
      'ATM_TASKFLOW_HOST_POLICY_PATH_AMBIGUOUS',
      'Host opener output-path pattern must include ${taskId}.',
      { exitCode: 1 }
    );
  }

  const slug = slugifyTitle(title ?? taskId);
  const outputPath = pattern
    .split('${taskId}').join(taskId)
    .split('${slug}').join(slug)
    .replace(/\\/g, '/');
  return {
    outputPath,
    diagnostics: [`Resolved canonical output path ${outputPath} from host-neutral policy pattern.`]
  };
}

function slugifyTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'task';
}

function taskFamilyFromId(taskId: string): string {
  return normalizeTaskId(taskId).replace(/-\d+$/, '');
}

function semanticKeyFromTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return normalized || 'task';
}

function readExistingTaskTitle(filePath: string, frontMatter: ReturnType<typeof extractFrontMatter>): string | null {
  if (typeof frontMatter?.data.title === 'string' && frontMatter.data.title.trim()) {
    return frontMatter.data.title.trim();
  }
  const raw = readFileSync(filePath, 'utf8');
  const heading = raw.split(/\r?\n/).find((line) => line.trim().startsWith('# '));
  return heading ? heading.replace(/^#\s+/, '').trim() : null;
}

function detectFamilyDrift(input: {
  cwd: string;
  directory: string;
  taskId: string;
  title: string | null;
}): HostOpenerFamilyDrift | null {
  const title = input.title?.trim();
  if (!title) return null;
  const absDir = path.resolve(input.cwd, input.directory);
  if (!existsSync(absDir)) return null;

  const requestedTaskId = normalizeTaskId(input.taskId);
  const requestedFamily = taskFamilyFromId(requestedTaskId);
  const requestedSemanticKey = semanticKeyFromTitle(title);

  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (!entry.isFile() || (!entry.name.endsWith('.task.md') && !entry.name.endsWith('.md'))) continue;
    const filePath = path.join(absDir, entry.name);
    try {
      const frontMatter = extractFrontMatter(readFileSync(filePath, 'utf8'));
      const rawTaskId = typeof frontMatter?.data.task_id === 'string'
        ? frontMatter.data.task_id
        : typeof frontMatter?.data.id === 'string'
          ? frontMatter.data.id
          : null;
      if (!rawTaskId) continue;
      const existingTaskId = normalizeTaskId(rawTaskId);
      const existingFamily = taskFamilyFromId(existingTaskId);
      if (existingFamily === requestedFamily) continue;
      const existingTitle = readExistingTaskTitle(filePath, frontMatter);
      if (!existingTitle || semanticKeyFromTitle(existingTitle) !== requestedSemanticKey) continue;
      const existingPath = path.relative(input.cwd, filePath).replace(/\\/g, '/');
      return {
        schemaId: 'atm.taskIdFamilyDrift.v1',
        status: 'duplicate-semantic-family',
        code: 'ATM_TASK_ID_FAMILY_DRIFT',
        requestedTaskId,
        requestedFamily,
        requestedSemanticKey,
        existingTaskId,
        existingFamily,
        existingPath,
        message: `Task title "${title}" already exists under semantic family ${existingFamily}; do not mint ${requestedFamily} for the same family.`
      };
    } catch {
      // Ignore unreadable or non-task markdown while scanning the planning directory.
    }
  }
  return null;
}

export function resolveHostOpenerPolicyDecision(input: HostOpenerPolicyInput): HostOpenerPolicyDecision {
  const diagnostics: string[] = [];
  let taskId = input.taskId?.trim() || null;
  let outputPath = input.outputPath?.trim() || null;
  const sources: HostOpenerPolicyDecision['sources'] = {
    taskId: 'explicit',
    outputPath: 'explicit'
  };

  if (!taskId) {
    const allocated = allocateTaskIdFromPolicy(input.cwd, input.profile, input.delegationContract.policy);
    taskId = allocated.taskId;
    sources.taskId = 'host-policy';
    diagnostics.push(...allocated.diagnostics);
  }

  if (!outputPath) {
    const resolved = resolveOutputPathFromPolicy(taskId, input.title ?? null, input.delegationContract.policy);
    outputPath = resolved.outputPath;
    sources.outputPath = 'host-policy';
    diagnostics.push(...resolved.diagnostics);
  }

  const absoluteOutput = path.resolve(input.cwd, outputPath);
  if (existsSync(absoluteOutput)) {
    diagnostics.push(`Canonical output path already exists and may be reused by taskflow open: ${outputPath}.`);
  }
  const familyDrift = detectFamilyDrift({
    cwd: input.cwd,
    directory: input.delegationContract.policy.resolveCanonicalOutputPath.directory ?? path.dirname(outputPath),
    taskId,
    title: input.title ?? null
  });
  if (familyDrift) {
    diagnostics.push(`${familyDrift.code}: ${familyDrift.message}`);
  }

  return {
    taskId: normalizeTaskId(taskId),
    outputPath: outputPath.replace(/\\/g, '/'),
    sources,
    diagnostics,
    familyDrift
  };
}

export function canResolveHostOpenerPolicy(input: HostOpenerPolicyInput): boolean {
  if (!input.delegationContract.invocable) {
    return false;
  }
  const canAllocate = Boolean(input.taskId?.trim())
    || input.delegationContract.policy.allocateTaskId.mode === 'host-opener';
  const canResolvePath = Boolean(input.outputPath?.trim())
    || input.delegationContract.policy.resolveCanonicalOutputPath.mode === 'host-opener';
  return canAllocate && canResolvePath;
}


/** Refresh all origin heads: cached main alone cannot reserve a task number. */
export function collectOriginTaskSuffixes(cwd: string, format: string, directory: string): number[] {
  const git = (args: string[], allowFailure = false): string => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0 && !allowFailure) {
      throw new Error('Cannot discover origin task IDs; run git fetch origin before allocating a task. ' + (result.stderr || result.error?.message || 'Git failed.'));
    }
    return result.status === 0 ? result.stdout.trim() : '';
  };
  if (!git(['rev-parse', '--git-dir'], true) || !git(['remote']).split('\n').includes('origin')) return [];
  git(['fetch', '--no-tags', '--prune', 'origin', '+refs/heads/*:refs/remotes/origin/*']);
  const refs = git(['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/']).split('\n').filter(Boolean);
  const roots = [...new Set(['.atm/task-plans', '.atm/history/tasks', ...(directory === '.' ? [] : [directory])])];
  const trees = new Set<string>();
  for (const ref of refs) {
    for (const root of roots) {
      const tree = git(['rev-parse', '--verify', `${ref}:${root}`], true);
      if (tree) trees.add(tree);
    }
  }
  const prefix = format.replace(/N+$/, '');
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}(\\d+)(?![A-Za-z0-9])`, 'g');
  const suffixes = new Set<number>();
  for (const tree of trees) {
    // Scan contents as well as names: plan documents may contain several cards.
    const names = git(['ls-tree', '-r', '--name-only', tree]);
    const result = spawnSync('git', ['grep', '-h', '-I', '-o', '-E', `${escaped}[0-9]+`, tree], {
      cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
    });
    if (result.status !== 0 && result.status !== 1) throw new Error('Cannot read origin task cards; refresh origin before allocating.');
    for (const match of `${names}\n${result.stdout}`.matchAll(pattern)) suffixes.add(Number(match[1]));
  }
  return [...suffixes];
}
