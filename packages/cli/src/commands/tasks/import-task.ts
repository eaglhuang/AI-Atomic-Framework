import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { CliError } from '../shared.ts';
import { resolvePlanAbsoluteFromStored, toStoredPlanningPath } from '../planning-repo-root.ts';
import { extractFrontMatter } from './task-import-validators.ts';

export interface PlanningSourceSeal {
  readonly schemaId: 'atm.planningSourceSeal.v1';
  readonly repoIdentity: string;
  readonly repoRoot: string;
  readonly taskCardPath: string;
  readonly planningCommitSha: string | null;
  readonly contentDigest: string;
  readonly amendmentEpoch: number;
  readonly sealedAt: string;
}

export interface PlanningSourceSealValidation {
  readonly ok: boolean;
  readonly status: 'match' | 'governed-amendment' | 'drift';
  readonly driftKinds: readonly PlanningSourceDriftKind[];
  readonly sealed: PlanningSourceSeal | null;
  readonly current: PlanningSourceSeal | null;
  readonly diagnostics: {
    readonly codes: readonly string[];
    readonly messages: readonly string[];
  };
}

export type PlanningSourceDriftKind = 'path' | 'commit' | 'content' | 'repo-identity' | 'amendment-epoch';

function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

function tryGit(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim() || null;
  } catch {
    return null;
  }
}

function resolveGitRoot(filePath: string): string {
  return tryGit(path.dirname(filePath), ['rev-parse', '--show-toplevel']) ?? path.dirname(filePath);
}

function resolveRepoIdentity(repoRoot: string): string {
  return tryGit(repoRoot, ['config', '--get', 'remote.origin.url'])
    ?? tryGit(repoRoot, ['rev-parse', '--show-toplevel'])
    ?? path.resolve(repoRoot);
}

function resolveLastCardCommit(repoRoot: string, absolutePath: string): string | null {
  const relative = path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
  return tryGit(repoRoot, ['log', '-1', '--format=%H', '--', relative]);
}

function readAmendmentEpoch(markdown: string): number {
  const frontMatter = extractFrontMatter(markdown);
  const raw = frontMatter?.data.amendment_epoch ?? frontMatter?.data.amendmentEpoch ?? 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function buildPlanningSourceSeal(input: {
  readonly cwd: string;
  readonly planAbsolute: string;
  readonly planText?: string | null;
  readonly sealedAt: string;
}): PlanningSourceSeal {
  const planText = input.planText ?? readFileSync(input.planAbsolute, 'utf8');
  const repoRoot = resolveGitRoot(input.planAbsolute);
  return {
    schemaId: 'atm.planningSourceSeal.v1',
    repoIdentity: resolveRepoIdentity(repoRoot),
    repoRoot: repoRoot.replace(/\\/g, '/'),
    taskCardPath: toStoredPlanningPath(input.cwd, input.planAbsolute),
    planningCommitSha: resolveLastCardCommit(repoRoot, input.planAbsolute),
    contentDigest: sha256(planText),
    amendmentEpoch: readAmendmentEpoch(planText),
    sealedAt: input.sealedAt
  };
}

function readStoredSeal(taskDocument: Record<string, unknown>): PlanningSourceSeal | null {
  const source = taskDocument.source;
  const seal = source && typeof source === 'object' && !Array.isArray(source)
    ? (source as Record<string, unknown>).planningSourceSeal
    : null;
  if (!seal || typeof seal !== 'object' || Array.isArray(seal)) return null;
  const record = seal as Record<string, unknown>;
  if (record.schemaId !== 'atm.planningSourceSeal.v1') return null;
  if (typeof record.repoIdentity !== 'string' || typeof record.repoRoot !== 'string' || typeof record.taskCardPath !== 'string') return null;
  if (typeof record.contentDigest !== 'string' || typeof record.sealedAt !== 'string') return null;
  return {
    schemaId: 'atm.planningSourceSeal.v1',
    repoIdentity: record.repoIdentity,
    repoRoot: record.repoRoot,
    taskCardPath: record.taskCardPath,
    planningCommitSha: typeof record.planningCommitSha === 'string' ? record.planningCommitSha : null,
    contentDigest: record.contentDigest,
    amendmentEpoch: Number(record.amendmentEpoch ?? 0),
    sealedAt: record.sealedAt
  };
}

export function attachPlanningSourceSeal<TTask extends { source: object }>(
  task: TTask,
  seal: PlanningSourceSeal
): TTask {
  return {
    ...task,
    source: {
      ...(task.source as Record<string, unknown>),
      planningSourceSeal: seal
    }
  } as TTask;
}

export function validatePlanningSourceSeal(input: {
  readonly cwd: string;
  readonly taskDocument: Record<string, unknown>;
}): PlanningSourceSealValidation {
  const sealed = readStoredSeal(input.taskDocument);
  if (!sealed) {
    return {
      ok: true,
      status: 'match',
      driftKinds: [],
      sealed: null,
      current: null,
      diagnostics: {
        codes: ['ATM_PLANNING_SOURCE_SEAL_ABSENT'],
        messages: ['No planning-source seal is recorded; legacy task allowed without identity revalidation.']
      }
    };
  }
  const source = input.taskDocument.source && typeof input.taskDocument.source === 'object' && !Array.isArray(input.taskDocument.source)
    ? input.taskDocument.source as Record<string, unknown>
    : {};
  const sourcePlanPath = typeof source.planPath === 'string' ? source.planPath : sealed.taskCardPath;
  const planAbsolute = resolvePlanAbsoluteFromStored(input.cwd, sourcePlanPath);
  if (!existsSync(planAbsolute)) {
    return {
      ok: false,
      status: 'drift',
      driftKinds: ['path'],
      sealed,
      current: null,
      diagnostics: {
        codes: ['ATM_PLANNING_SOURCE_DRIFT_PATH'],
        messages: [`Planning card path is missing or moved: ${sourcePlanPath}.`]
      }
    };
  }
  const current = buildPlanningSourceSeal({
    cwd: input.cwd,
    planAbsolute,
    sealedAt: sealed.sealedAt
  });
  const driftKinds: PlanningSourceDriftKind[] = [];
  if (current.taskCardPath !== sealed.taskCardPath || sourcePlanPath !== sealed.taskCardPath) driftKinds.push('path');
  if (current.repoIdentity !== sealed.repoIdentity) driftKinds.push('repo-identity');
  if (current.planningCommitSha !== sealed.planningCommitSha) driftKinds.push('commit');
  if (current.contentDigest !== sealed.contentDigest) driftKinds.push('content');
  if (current.amendmentEpoch !== sealed.amendmentEpoch) driftKinds.push('amendment-epoch');

  const governedAmendment = driftKinds.every((kind) => kind === 'commit' || kind === 'content' || kind === 'amendment-epoch')
    && current.amendmentEpoch > sealed.amendmentEpoch;
  const ok = driftKinds.length === 0 || governedAmendment;
  const status: PlanningSourceSealValidation['status'] = driftKinds.length === 0
    ? 'match'
    : governedAmendment
      ? 'governed-amendment'
      : 'drift';
  return {
    ok,
    status,
    driftKinds,
    sealed,
    current,
    diagnostics: {
      codes: driftKinds.length === 0
        ? ['ATM_PLANNING_SOURCE_SEAL_MATCH']
        : driftKinds.map((kind) => `ATM_PLANNING_SOURCE_DRIFT_${kind.toUpperCase().replace(/-/g, '_')}`),
      messages: driftKinds.length === 0
        ? ['Planning-source seal matches the current external task card.']
        : [`Planning-source seal ${status}: ${driftKinds.join(', ')}.`]
    }
  };
}

export function assertPlanningSourceSealValid(input: {
  readonly cwd: string;
  readonly taskDocument: Record<string, unknown>;
  readonly surface: 'claim' | 'close';
}): PlanningSourceSealValidation {
  const validation = validatePlanningSourceSeal(input);
  if (!validation.ok) {
    throw new CliError(
      'ATM_PLANNING_SOURCE_IDENTITY_DRIFT',
      `Planning source identity drift blocked ${input.surface}: ${validation.driftKinds.join(', ')}.`,
      {
        exitCode: 1,
        details: validation as unknown as Record<string, unknown>
      }
    );
  }
  return validation;
}
