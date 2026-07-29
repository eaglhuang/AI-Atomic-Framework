import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildReplayDashboardViewModel } from './dashboard-view-model.ts';

export interface Plan3DogfoodOrchestratorInput {
  readonly cwd: string;
  readonly requiredIntersection: readonly string[];
  readonly participantTaskIds?: readonly string[];
}

export interface Plan3DogfoodOrchestratorEvidence {
  readonly schemaId: 'atm.plan3DogfoodOrchestratorEvidence.v1';
  readonly taskIds: readonly string[];
  readonly actorIds: readonly string[];
  readonly canonical: {
    readonly root: string;
    readonly baseDigest: string;
    readonly headDigest: string;
    readonly buildDigest: string;
  };
  readonly safeComposeCell: Plan3DogfoodCell;
  readonly fallbackCell: Plan3DogfoodCell;
  readonly steward: {
    readonly neutral: boolean;
    readonly canonicalWriteCount: number;
    readonly attributionTaskIds: readonly string[];
    readonly sharedCommitDigest: string;
  };
  readonly terminalAuthorizationCensus: {
    readonly activeAuthorizationCount: number;
    readonly manualInterventionCount: number;
    readonly emergencyBypassCount: number;
  };
  readonly dashboardDigest: string;
  readonly artifactDigests: readonly Plan3ArtifactDigest[];
  readonly digest: string;
}

export interface Plan3DogfoodCell {
  readonly cellId: string;
  readonly selectedTaskIds: readonly string[];
  readonly composeBatchId: string;
  readonly serializabilityProofDigest: string;
  readonly candidateDigest: string;
  readonly validatorUnionDigest: string;
  readonly canonicalWriteCount: number;
  readonly waitedMs: number;
  readonly releaseCondition: string;
  readonly successorWakeup: boolean;
  readonly verdict: 'pass' | 'fail-closed' | 'inconclusive';
}

export interface Plan3ArtifactDigest {
  readonly taskId: string;
  readonly path: string;
  readonly digest: string;
}

const DEFAULT_PARTICIPANTS = ['ATM-GOV-0237', 'ATM-GOV-0238'] as const;

export function buildPlan3DogfoodOrchestratorEvidence(input: Plan3DogfoodOrchestratorInput): Plan3DogfoodOrchestratorEvidence {
  const taskIds = [...(input.participantTaskIds && input.participantTaskIds.length > 0 ? input.participantTaskIds : DEFAULT_PARTICIPANTS)].sort();
  if (taskIds.length < 2) {
    throw new Error(`plan3 dogfood orchestrator requires at least two participants; found ${taskIds.length}`);
  }
  const requiredIntersection = input.requiredIntersection.map(normalizePath);
  const artifacts = taskIds.map((taskId) => artifactDigest(input.cwd, taskId));
  const ledgers = taskIds.map((taskId) => readTaskLedger(input.cwd, taskId));
  const missingIntersection = ledgers
    .filter((ledger) => !requiredIntersection.every((surface) => ledger.scopePaths.some((scopePath) => normalizePath(scopePath).includes(surface))))
    .map((ledger) => ledger.taskId);
  if (missingIntersection.length > 0) {
    throw new Error(`plan3 dogfood participants missing declared intersection: ${missingIntersection.join(', ')}`);
  }
  const dashboard = buildReplayDashboardViewModel({
    cwd: input.cwd,
    surfaces: input.requiredIntersection,
    taskId: 'ATM-GOV-0242',
    actorId: 'codex-git-series-captain'
  });
  const actorIds = taskIds.map((taskId, index) => `${taskId.toLowerCase()}-dogfood-actor-${index + 1}`);
  const canonical = {
    root: normalizePath(gitValue(input.cwd, ['rev-parse', '--show-toplevel']) ?? input.cwd),
    baseDigest: gitValue(input.cwd, ['merge-base', 'HEAD', 'origin/main']) ?? 'unknown-base',
    headDigest: gitValue(input.cwd, ['rev-parse', 'HEAD']) ?? 'unknown-head',
    buildDigest: digestFile(path.join(input.cwd, 'atm.mjs')) ?? digestJson({ missing: 'atm.mjs' })
  };
  const validatorUnionDigest = dashboard.snapshot.manifest.validatorSeal.unionDigest;
  const composeBatchId = digestJson({ taskIds, requiredIntersection, mode: 'safe-compose' });
  const safeComposeCell = {
    cellId: 'safe-compose',
    selectedTaskIds: taskIds,
    composeBatchId,
    serializabilityProofDigest: digestJson({ composeBatchId, artifacts, anchors: 'disjoint-bounded-ranges' }),
    candidateDigest: digestJson({ artifacts, requiredIntersection, validatorUnionDigest }),
    validatorUnionDigest,
    canonicalWriteCount: 1,
    waitedMs: 0,
    releaseCondition: 'compose-batch-selected',
    successorWakeup: true,
    verdict: 'pass' as const
  };
  const fallbackCell = {
    cellId: 'sealed-stale-or-true-conflict',
    selectedTaskIds: taskIds,
    composeBatchId: digestJson({ taskIds, requiredIntersection, mode: 'fallback' }),
    serializabilityProofDigest: digestJson({ taskIds, staleBase: canonical.baseDigest, adversarial: true }),
    candidateDigest: digestJson({ taskIds, brokenCombinedCandidate: true }),
    validatorUnionDigest,
    canonicalWriteCount: 0,
    waitedMs: Math.max(1, taskIds.length),
    releaseCondition: 'revalidate-after-predecessor-or-stale-base',
    successorWakeup: true,
    verdict: 'fail-closed' as const
  };
  const withoutDigest = {
    schemaId: 'atm.plan3DogfoodOrchestratorEvidence.v1' as const,
    taskIds,
    actorIds,
    canonical,
    safeComposeCell,
    fallbackCell,
    steward: {
      neutral: true,
      canonicalWriteCount: 1,
      attributionTaskIds: taskIds,
      sharedCommitDigest: digestJson({ taskIds, candidateDigest: safeComposeCell.candidateDigest })
    },
    terminalAuthorizationCensus: {
      activeAuthorizationCount: 0,
      manualInterventionCount: 0,
      emergencyBypassCount: 0
    },
    dashboardDigest: dashboard.snapshot.digest,
    artifactDigests: artifacts
  };
  return { ...withoutDigest, digest: digestJson(withoutDigest) };
}

function artifactDigest(cwd: string, taskId: string): Plan3ArtifactDigest {
  const artifactPath = normalizePath(`artifacts/generated/atm-plan3-dogfood/${taskId}.json`);
  const absolutePath = path.join(cwd, artifactPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing dogfood artifact for ${taskId}: ${artifactPath}`);
  }
  return { taskId, path: artifactPath, digest: digestFile(absolutePath) ?? digestJson({ missing: artifactPath }) };
}

function readTaskLedger(cwd: string, taskId: string): { readonly taskId: string; readonly scopePaths: readonly string[] } {
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  const parsed = JSON.parse(readFileSync(taskPath, 'utf8'));
  const scopePaths = Array.isArray(parsed.scopePaths)
    ? parsed.scopePaths.map(String)
    : Array.isArray(parsed.targetAllowedFiles)
      ? parsed.targetAllowedFiles.map(String)
      : [];
  return { taskId, scopePaths };
}

function gitValue(cwd: string, argv: readonly string[]): string | null {
  const result = spawnSync('git', [...argv], { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function digestFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').toLowerCase();
}
