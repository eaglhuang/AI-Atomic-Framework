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
}

export interface HostOpenerPolicyInput {
  cwd: string;
  profile: TaskflowProfileV1;
  delegationContract: TaskflowDelegationContract;
  taskId?: string | null;
  outputPath?: string | null;
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
  const existing = collectExistingNumericSuffixes(cwd, directory, format);
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

  const outputPath = pattern.split('${taskId}').join(taskId).replace(/\\/g, '/');
  return {
    outputPath,
    diagnostics: [`Resolved canonical output path ${outputPath} from host-neutral policy pattern.`]
  };
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
    const resolved = resolveOutputPathFromPolicy(taskId, input.delegationContract.policy);
    outputPath = resolved.outputPath;
    sources.outputPath = 'host-policy';
    diagnostics.push(...resolved.diagnostics);
  }

  const absoluteOutput = path.resolve(input.cwd, outputPath);
  if (existsSync(absoluteOutput)) {
    throw new CliError(
      'ATM_TASKFLOW_HOST_POLICY_PATH_COLLISION',
      `Canonical output path already exists: ${outputPath}`,
      { exitCode: 1, details: { taskId, outputPath } }
    );
  }

  return {
    taskId: normalizeTaskId(taskId),
    outputPath: outputPath.replace(/\\/g, '/'),
    sources,
    diagnostics
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
