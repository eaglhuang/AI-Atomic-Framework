import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildPlanningMirrorClosebackExpectation, classifyPlanningMirrorPreEdit } from '../tasks/planning-mirror-close-diagnostics.ts';
import { appendTaskTransitionEvent, createTaskTransitionId } from '../task-ledger.ts';
import { resolvePlanningPathFromStored } from '../planning-repo-root.ts';
import { CliError } from '../shared.ts';
export {
  assertClosebackPlanningPathReady,
  buildCloseBackendArgv,
  buildClosebackPlan,
  buildCloseWriteRollbackSnapshot,
  buildTaskflowCloseDiagnostics,
  executeCloseWriteCommitPhase,
  listOptionalEvidenceBundleGovernanceArtifacts,
  resolveCloseWriteSupport,
  resolveClosebackPlanningPath,
  type ClosebackPlanningPathResolution,
  type TaskScopeAmendmentSummary,
  type TaskflowClosebackPlan
} from './close-orchestration.ts';

export interface PlanningCardCloseback {
  mode: 'frontmatter-closeback' | 'frontmatter-pre-edit-absorbed';
  repoRoot: string;
  relativePath: string;
  transitionPath: string | null;
  updatedFields: string[];
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
  const probe = existsSync(startPath) ? (statSync(startPath).isDirectory() ? startPath : path.dirname(startPath)) : path.dirname(startPath);
  const root = tryGitScalar(probe, ['rev-parse', '--show-toplevel']);
  return root ? path.resolve(root) : null;
}

function normalizeRepoRelativePath(repoRoot: string, filePath: string): string {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
  return path.relative(repoRoot, resolved).replace(/\\/g, '/');
}

function resolvePlanningPath(cwd: string, planningMirrorPath: string | null): { repoRoot: string | null; relativePath: string | null; reason: string | null } {
  return resolvePlanningPathFromStored(cwd, planningMirrorPath);
}

function quoteYamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function upsertFrontmatterField(frontmatter: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:.*$`, 'm');
  if (pattern.test(frontmatter)) {
    return frontmatter.replace(pattern, `${key}: ${value}`);
  }
  const trimmed = frontmatter.replace(/\s+$/, '');
  return `${trimmed}\n${key}: ${value}`;
}

function parseTaskMarkdownFrontmatter(text: string): Record<string, unknown> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, unknown> = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const separatorIndex = rawLine.indexOf(':');
    if (separatorIndex === -1) continue;
    const key = rawLine.slice(0, separatorIndex).trim();
    const value = rawLine.slice(separatorIndex + 1).trim().replace(/^"(.*)"$/, '$1');
    if (key) result[key] = value;
  }
  return result;
}

export function capturePlanningCardSnapshot(input: {
  cwd: string;
  planningMirrorPath: string | null;
}): { absolutePath: string; previousContent: string } | null {
  const planning = resolvePlanningPath(input.cwd, input.planningMirrorPath);
  if (!planning.repoRoot || !planning.relativePath) {
    return null;
  }
  const absolutePath = path.resolve(planning.repoRoot, planning.relativePath);
  if (!existsSync(absolutePath)) {
    return null;
  }
  return {
    absolutePath,
    previousContent: readFileSync(absolutePath, 'utf8')
  };
}

export function applyPlanningCardCloseback(input: {
  cwd: string;
  planningMirrorPath: string | null;
  actorId: string;
  historicalDeliveryRefs: string[];
}): PlanningCardCloseback | null {
  const planning = resolvePlanningPath(input.cwd, input.planningMirrorPath);
  if (!planning.repoRoot || !planning.relativePath) {
    return null;
  }
  const absolutePath = path.resolve(planning.repoRoot, planning.relativePath);
  if (!existsSync(absolutePath)) {
    throw new CliError('ATM_TASKFLOW_CLOSE_PLANNING_CARD_MISSING', 'taskflow close could not find the planning card for closeback.', {
      exitCode: 1,
      details: { planningMirrorPath: input.planningMirrorPath, planning }
    });
  }
  const content = readFileSync(absolutePath, 'utf8');
  const expectation = buildPlanningMirrorClosebackExpectation(
    input.actorId,
    input.historicalDeliveryRefs[0] ?? null
  );
  const preEditClassification = classifyPlanningMirrorPreEdit({
    relativePath: planning.relativePath,
    fileContent: content,
    expectation
  });
  if (preEditClassification === 'correct-pre-edit') {
    return {
      mode: 'frontmatter-pre-edit-absorbed',
      repoRoot: planning.repoRoot,
      relativePath: planning.relativePath,
      transitionPath: null,
      updatedFields: ['status', 'completed_at', 'completed_by_agent', ...(expectation.deliveryCommit ? ['delivery_commit'] : [])]
    };
  }
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);
  if (!match) {
    throw new CliError('ATM_TASKFLOW_CLOSE_PLANNING_FRONTMATTER_MISSING', 'taskflow close requires planning card frontmatter for governed closeback.', {
      exitCode: 1,
      details: { planningMirrorPath: input.planningMirrorPath, planning }
    });
  }
  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
  const previousDocument = parseTaskMarkdownFrontmatter(content);
  const taskId = typeof previousDocument.task_id === 'string'
    ? previousDocument.task_id
    : (typeof previousDocument.taskId === 'string' ? previousDocument.taskId : path.basename(absolutePath).replace(/\.task\.md$/, ''));
  const previousStatus = typeof previousDocument.status === 'string' ? previousDocument.status : null;
  const completedAt = new Date().toISOString();
  const updatedFields = [
    'status',
    'completed_at',
    'completed_by_agent',
    'closedAt',
    'closedByActor',
    'closedByCommand',
    'lastTransitionId',
    'lastTransitionAt',
    'ledgerContractVersion'
  ];
  const nextDocument: Record<string, unknown> = {
    ...previousDocument,
    status: 'done',
    completed_at: completedAt,
    completed_by_agent: input.actorId,
    closedAt: completedAt,
    closedByActor: input.actorId,
    closedByCommand: 'atm tasks close',
    ledgerContractVersion: 'task-ledger/v1'
  };
  const transitionId = createTaskTransitionId({
    createdAt: completedAt,
    taskId,
    action: 'close',
    taskDocument: nextDocument
  });
  nextDocument.lastTransitionId = transitionId;
  nextDocument.lastTransitionAt = completedAt;

  let frontmatter = match[1].replace(/\r\n/g, '\n');
  frontmatter = upsertFrontmatterField(frontmatter, 'status', 'done');
  frontmatter = upsertFrontmatterField(frontmatter, 'completed_at', quoteYamlString(completedAt));
  frontmatter = upsertFrontmatterField(frontmatter, 'completed_by_agent', quoteYamlString(input.actorId));
  frontmatter = upsertFrontmatterField(frontmatter, 'closedAt', quoteYamlString(completedAt));
  frontmatter = upsertFrontmatterField(frontmatter, 'closedByActor', quoteYamlString(input.actorId));
  frontmatter = upsertFrontmatterField(frontmatter, 'closedByCommand', 'atm tasks close');
  frontmatter = upsertFrontmatterField(frontmatter, 'lastTransitionId', quoteYamlString(transitionId));
  frontmatter = upsertFrontmatterField(frontmatter, 'lastTransitionAt', quoteYamlString(completedAt));
  frontmatter = upsertFrontmatterField(frontmatter, 'ledgerContractVersion', 'task-ledger/v1');
  if (input.historicalDeliveryRefs[0]) {
    frontmatter = upsertFrontmatterField(frontmatter, 'delivery_commit', quoteYamlString(input.historicalDeliveryRefs[0]));
    updatedFields.push('delivery_commit');
    nextDocument.delivery_commit = input.historicalDeliveryRefs[0];
  }
  const rest = content.slice(match[0].length);
  const normalizedFrontmatter = frontmatter.split('\n').join(lineEnding);
  writeFileSync(absolutePath, `---${lineEnding}${normalizedFrontmatter}${lineEnding}---${lineEnding}${rest}`, 'utf8');
  const transition = appendTaskTransitionEvent({
    cwd: planning.repoRoot,
    taskId,
    action: 'close',
    actorId: input.actorId,
    fromStatus: previousStatus,
    toStatus: 'done',
    taskPath: absolutePath,
    taskDocument: nextDocument,
    command: `node atm.mjs tasks close --task ${taskId} --actor ${input.actorId}`,
    createdAt: completedAt,
    transitionId
  });
  return {
    mode: 'frontmatter-closeback',
    repoRoot: planning.repoRoot,
    relativePath: planning.relativePath,
    transitionPath: transition.eventPath,
    updatedFields
  };
}

export function resolvePlanningRosterPaths(input: {
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
