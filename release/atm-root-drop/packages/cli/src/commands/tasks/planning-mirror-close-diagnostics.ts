import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extractFrontMatter } from './task-import-validators.ts';
import { normalizeRelativePath } from './task-file-io-helpers.ts';

export interface PlanningMirrorClosebackExpectation {
  readonly status: 'done';
  readonly completedByActor: string;
  readonly deliveryCommit: string | null;
}

export type PlanningMirrorPreEditClassification =
  | 'correct-pre-edit'
  | 'incorrect-pre-edit'
  | 'not-applicable';

export interface PlanningMirrorDirtyEvaluation {
  readonly correctPlanningMirrorPreEditFiles: readonly string[];
  readonly incorrectPlanningMirrorPreEditFiles: readonly string[];
  readonly remediation: string | null;
}

function normalizeLifecycleValue(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
  return normalized || null;
}

function normalizeFrontmatterScalar(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
    return trimmed.slice(1, -1).trim() || null;
  }
  return trimmed;
}

export function buildPlanningMirrorClosebackExpectation(
  actorId: string,
  historicalDeliveryRef: string | null
): PlanningMirrorClosebackExpectation {
  return {
    status: 'done',
    completedByActor: actorId.trim(),
    deliveryCommit: historicalDeliveryRef?.trim() || null
  };
}

export function classifyPlanningMirrorPreEdit(input: {
  readonly relativePath: string;
  readonly fileContent: string;
  readonly expectation: PlanningMirrorClosebackExpectation;
}): PlanningMirrorPreEditClassification {
  const frontMatter = extractFrontMatter(input.fileContent);
  if (!frontMatter) return 'not-applicable';

  const status = normalizeLifecycleValue(typeof frontMatter.data.status === 'string' ? frontMatter.data.status : null);
  const completedBy = normalizeFrontmatterScalar(frontMatter.data.completed_by_agent);
  const completedAt = normalizeFrontmatterScalar(frontMatter.data.completed_at);
  const deliveryCommit = normalizeFrontmatterScalar(frontMatter.data.delivery_commit);

  if (status !== input.expectation.status) {
    return status === 'done' ? 'incorrect-pre-edit' : 'not-applicable';
  }
  if (!completedAt) {
    return 'incorrect-pre-edit';
  }
  if (!completedBy || completedBy !== input.expectation.completedByActor) {
    return 'incorrect-pre-edit';
  }
  if (input.expectation.deliveryCommit) {
    if (!deliveryCommit || deliveryCommit !== input.expectation.deliveryCommit) {
      return 'incorrect-pre-edit';
    }
  }
  return 'correct-pre-edit';
}

export function evaluatePlanningMirrorDirtyFiles(input: {
  readonly planningRepoRoot: string | null;
  readonly planningMirrorRelativePath: string | null;
  readonly trackedDirtyFiles: readonly string[];
  readonly actorId: string;
  readonly historicalDeliveryRef: string | null;
}): PlanningMirrorDirtyEvaluation {
  if (!input.planningRepoRoot || !input.planningMirrorRelativePath) {
    return {
      correctPlanningMirrorPreEditFiles: [],
      incorrectPlanningMirrorPreEditFiles: [],
      remediation: null
    };
  }
  const expectation = buildPlanningMirrorClosebackExpectation(input.actorId, input.historicalDeliveryRef);
  const normalizedMirrorPath = normalizeRelativePath(input.planningMirrorRelativePath);
  const correct: string[] = [];
  const incorrect: string[] = [];

  for (const dirtyPath of input.trackedDirtyFiles) {
    const normalizedDirty = normalizeRelativePath(dirtyPath);
    if (normalizedDirty !== normalizedMirrorPath) continue;
    const absolutePath = path.resolve(input.planningRepoRoot, normalizedDirty);
    let content = '';
    try {
      content = readFileSync(absolutePath, 'utf8');
    } catch {
      incorrect.push(normalizedDirty);
      continue;
    }
    const classification = classifyPlanningMirrorPreEdit({
      relativePath: normalizedDirty,
      fileContent: content,
      expectation
    });
    if (classification === 'correct-pre-edit') {
      correct.push(normalizedDirty);
    } else if (classification === 'incorrect-pre-edit') {
      incorrect.push(normalizedDirty);
    }
  }

  return {
    correctPlanningMirrorPreEditFiles: correct,
    incorrectPlanningMirrorPreEditFiles: incorrect,
    remediation: incorrect.length > 0
      ? `Restore the planning mirror to a governed closeback state, or rerun taskflow close --dry-run and apply only the frontmatter fields ATM would write (status, completed_at, completed_by_agent, delivery_commit).`
      : null
  };
}
