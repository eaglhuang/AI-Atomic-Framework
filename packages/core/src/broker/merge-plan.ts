import { createHash } from 'node:crypto';
import type { ConflictDetail, MergePlan, PatchAnchor, PatchProposal } from './types.ts';

export const defaultMergePlanMigration = {
  strategy: 'none' as const,
  fromVersion: null,
  notes: 'deterministic compose'
};

export interface PatchHunkRange {
  readonly oldStart: number;
  readonly oldLength: number;
}

export function anchorKey(anchor: PatchAnchor): string {
  return `${anchor.kind}::${anchor.hint}`;
}

export function firstAnchorKey(proposal: PatchProposal): string {
  const keys = [...proposal.anchors]
    .map((anchor) => anchorKey(anchor))
    .sort((left, right) => left.localeCompare(right));
  return keys[0] ?? '';
}

export function compareProposalsForCompose(left: PatchProposal, right: PatchProposal): number {
  const targetCompare = left.targetFile.localeCompare(right.targetFile);
  if (targetCompare !== 0) return targetCompare;
  const anchorCompare = firstAnchorKey(left).localeCompare(firstAnchorKey(right));
  if (anchorCompare !== 0) return anchorCompare;
  return left.proposalId.localeCompare(right.proposalId);
}

export function sortProposalsForCompose(proposals: readonly PatchProposal[]): PatchProposal[] {
  return [...proposals].sort(compareProposalsForCompose);
}

export function parsePatchHunkRanges(patch: string): readonly PatchHunkRange[] {
  const ranges: PatchHunkRange[] = [];
  for (const line of patch.split(/\r?\n/)) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line.trim());
    if (!match) continue;
    const oldStart = Number.parseInt(match[1], 10);
    const oldLength = match[2] ? Number.parseInt(match[2], 10) : 1;
    if (!Number.isFinite(oldStart) || !Number.isFinite(oldLength) || oldLength < 0) continue;
    ranges.push({ oldStart, oldLength });
  }
  return ranges;
}

export function patchHunkRangesOverlap(left: PatchHunkRange, right: PatchHunkRange): boolean {
  const leftEnd = left.oldStart + Math.max(left.oldLength, 1) - 1;
  const rightEnd = right.oldStart + Math.max(right.oldLength, 1) - 1;
  return left.oldStart <= rightEnd && right.oldStart <= leftEnd;
}

export function buildDeterministicMergePlanId(proposalIds: readonly string[]): string {
  const digest = createHash('sha256')
    .update([...proposalIds].sort((left, right) => left.localeCompare(right)).join('\n'))
    .digest('hex');
  return `merge-${digest.slice(0, 16)}`;
}

export function collectRequiredEvidence(proposals: readonly PatchProposal[]): readonly string[] {
  const evidence = new Set<string>();
  for (const proposal of proposals) {
    for (const validator of proposal.validators) {
      const trimmed = validator.trim();
      if (trimmed.length > 0) evidence.add(trimmed);
    }
  }
  return [...evidence].sort((left, right) => left.localeCompare(right));
}

export function resolveMergePlanApplyMethod(verdict: MergePlan['verdict']): MergePlan['applyMethod'] {
  if (verdict === 'parallel-safe') return 'patch-apply';
  return 'steward-authored-final-patch';
}

export function buildMergePlan(input: {
  readonly proposals: readonly PatchProposal[];
  readonly verdict: MergePlan['verdict'];
  readonly conflicts: readonly ConflictDetail[];
}): MergePlan {
  const sorted = sortProposalsForCompose(input.proposals);
  const inputProposals = sorted.map((proposal) => proposal.proposalId);
  return {
    schemaId: 'atm.mergePlan.v1',
    specVersion: '0.1.0',
    migration: defaultMergePlanMigration,
    mergePlanId: buildDeterministicMergePlanId(inputProposals),
    inputProposals,
    verdict: input.verdict,
    conflicts: [...input.conflicts],
    applyMethod: resolveMergePlanApplyMethod(input.verdict),
    requiredEvidence: collectRequiredEvidence(sorted)
  };
}
