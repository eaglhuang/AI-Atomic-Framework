import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildPlanningMirrorClosebackExpectation, classifyPlanningMirrorPreEdit } from '../tasks/planning-mirror-close-diagnostics.ts';
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
  const updatedFields = ['status', 'completed_at', 'completed_by_agent'];
  let frontmatter = match[1].replace(/\r\n/g, '\n');
  frontmatter = upsertFrontmatterField(frontmatter, 'status', 'done');
  frontmatter = upsertFrontmatterField(frontmatter, 'completed_at', quoteYamlString(new Date().toISOString()));
  frontmatter = upsertFrontmatterField(frontmatter, 'completed_by_agent', quoteYamlString(input.actorId));
  if (input.historicalDeliveryRefs[0]) {
    frontmatter = upsertFrontmatterField(frontmatter, 'delivery_commit', quoteYamlString(input.historicalDeliveryRefs[0]));
    updatedFields.push('delivery_commit');
  }
  const rest = content.slice(match[0].length);
  const normalizedFrontmatter = frontmatter.split('\n').join(lineEnding);
  writeFileSync(absolutePath, `---${lineEnding}${normalizedFrontmatter}${lineEnding}---${lineEnding}${rest}`, 'utf8');
  return {
    mode: 'frontmatter-closeback',
    repoRoot: planning.repoRoot,
    relativePath: planning.relativePath,
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
